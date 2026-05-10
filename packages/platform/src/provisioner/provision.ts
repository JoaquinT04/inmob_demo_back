/**
 * Provisioner de tenants.
 *
 * Flujo:
 *   1. Crea una nueva base de datos en PostgreSQL self-hosted via CREATE DATABASE
 *   2. Corre las migrations de @inmob/database en la nueva DB
 *   3. Crea el Tenant (fila única) + usuario owner con bcrypt
 *   4. Registra el tenant en la platform DB (TenantRegistry)
 *
 * Variables de entorno requeridas:
 *   POSTGRES_ADMIN_URL — conexión admin sin nombre de DB (ej: postgresql://inmob:pass@postgres:5432)
 *   APP_SECRET (para firmar el JWT de retorno)
 */
import { MikroORM } from '@mikro-orm/postgresql';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import tenantDbConfig from '@inmob/database/config';
import { TenantPlan, TenantStatus, SystemRole, SubscriptionStatus } from '@inmob/shared';
import { TenantRegistry } from '../entities/index.js';
import type { MikroORM as PlatformORM } from '@mikro-orm/postgresql';

export interface ProvisionInput {
  subdomain: string;
  name: string;
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
  password: string;
  taxId?: string;
  country?: string;
  timezone?: string;
  plan?: TenantPlan;
}

export interface ProvisionResult {
  subdomain: string;
  databaseUrl: string;
  ownerId: string;
  token: string;
}

// ─── PostgreSQL self-hosted ────────────────────────────────────────────────────

async function createLocalDatabase(dbName: string): Promise<{ poolerUrl: string; directUrl: string }> {
  const adminUrl = process.env['POSTGRES_ADMIN_URL'];
  if (!adminUrl) {
    throw new Error('POSTGRES_ADMIN_URL es requerido (ej: postgresql://inmob:pass@postgres:5432)');
  }

  const cleanUrl = adminUrl.replace(/\s+/g, '').replace(/\/$/, '');
  // Conectar a la DB de mantenimiento para poder emitir CREATE DATABASE
  const adminClient = new pg.Client({ connectionString: `${cleanUrl}/postgres` });
  await adminClient.connect();

  try {
    const { rows } = await adminClient.query<{ exists: string }>(
      `SELECT 1 AS exists FROM pg_database WHERE datname = $1`,
      [dbName],
    );
    if (rows.length === 0) {
      // CREATE DATABASE no puede correr dentro de una transacción
      await adminClient.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await adminClient.end();
  }

  const dbUrl = `${cleanUrl}/${dbName}`;
  return { poolerUrl: dbUrl, directUrl: dbUrl };
}

// ─── Migrations + seed via raw SQL (evita MetadataError en producción) ───────

async function setupTenantDb(
  databaseUrl: string,
  input: ProvisionInput,
): Promise<string> {
  console.log('[provision] running migrations on:', databaseUrl.replace(/:\/\/[^@]+@/, '://***@'));

  const isSsl = databaseUrl.includes('sslmode=require');
  const orm = await MikroORM.init({
    ...tenantDbConfig,
    clientUrl: databaseUrl,
    driverOptions: isSsl ? { connection: { ssl: { rejectUnauthorized: false } } } : {},
  });

  try {
    await orm.getSchemaGenerator().createSchema();
    console.log('[provision] schema created — seeding via pg.Client on:', databaseUrl.replace(/:\/\/[^@]+@/, '://***@'));
  } finally {
    await orm.close();
  }

  // Seed con pg.Client directo — conexión única, sin pool abstraction
  const client = new pg.Client({
    connectionString: databaseUrl,
    ...(isSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  console.log('[provision] pg.Client connected, db:', (await client.query('SELECT current_database() as db')).rows[0].db);

  const tenantId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const subId = crypto.randomUUID();
  const now = new Date();
  const trialEndsAt = new Date(now);
  trialEndsAt.setDate(trialEndsAt.getDate() + Number(process.env['TRIAL_DAYS'] ?? 30));
  const passwordHash = await bcrypt.hash(input.password, 10);
  const settings = JSON.stringify({
    locale: {
      country: input.country ?? 'AR',
      language: 'es',
      timezone: input.timezone ?? 'America/Argentina/Buenos_Aires',
      currency: input.country === 'AR' ? 'ARS' : 'USD',
    },
  });

  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO "tenants" (id, created_at, updated_at, name, slug, status, plan, tax_id, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, now, now, input.name, input.subdomain, TenantStatus.TRIAL, input.plan ?? TenantPlan.FREE, input.taxId ?? null, settings],
    );
    await client.query(
      `INSERT INTO "users" (id, created_at, updated_at, clerk_id, email, first_name, last_name,
        roles, is_active, two_factor_enabled, preferences, password_hash, tenant_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [ownerId, now, now, ownerId, input.ownerEmail, input.ownerFirstName, input.ownerLastName,
        JSON.stringify([SystemRole.OWNER]), true, false,
        JSON.stringify({ theme: 'dark', language: 'es', timezone: input.timezone ?? 'America/Argentina/Buenos_Aires' }),
        passwordHash, tenantId],
    );
    await client.query(
      `INSERT INTO "subscriptions" (id, created_at, updated_at, tenant_id, plan, status, trial_ends_at, cancel_at_period_end)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [subId, now, now, tenantId, input.plan ?? TenantPlan.FREE, SubscriptionStatus.TRIALING, trialEndsAt, false],
    );
    await client.query('COMMIT');
    console.log('[provision] seed OK — ownerId:', ownerId);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  return ownerId;
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function provision(
  input: ProvisionInput,
  platformOrm: PlatformORM,
): Promise<ProvisionResult> {
  const { subdomain, name, ownerEmail } = input;
  const dbName = `inmob_${subdomain.replace(/-/g, '_')}`;

  const { poolerUrl, directUrl } = await createLocalDatabase(dbName);
  console.log('[provision] directUrl for setup:', directUrl.replace(/:\/\/[^@]+@/, '://***@'));
  const ownerId = await setupTenantDb(directUrl, input);

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + Number(process.env['TRIAL_DAYS'] ?? 30));

  const em = platformOrm.em.fork();
  em.create(TenantRegistry, {
    subdomain,
    name,
    ownerEmail,
    databaseUrl: poolerUrl,
    plan: input.plan ?? TenantPlan.FREE,
    status: TenantStatus.TRIAL,
    subscriptionStatus: SubscriptionStatus.TRIALING,
    trialEndsAt,
    taxId: input.taxId,
    settings: {
      locale: {
        country: input.country ?? 'AR',
        language: 'es',
        timezone: input.timezone ?? 'America/Argentina/Buenos_Aires',
        currency: input.country === 'AR' ? 'ARS' : 'USD',
      },
    },
  });
  await em.flush();

  const secret = new TextEncoder().encode(
    process.env['APP_SECRET'] ?? 'dev-secret-inmob-change-in-production-32chars',
  );
  const token = await new SignJWT({ userId: ownerId, subdomain })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);

  return { subdomain, databaseUrl: poolerUrl, ownerId, token };
}
