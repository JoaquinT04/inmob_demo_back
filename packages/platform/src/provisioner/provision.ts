/**
 * Provisioner de tenants.
 *
 * Flujo:
 *   1. Crea una nueva base de datos en Neon via API
 *   2. Corre las migrations de @inmob/database en la nueva DB
 *   3. Crea el Tenant (fila única) + usuario owner con bcrypt
 *   4. Registra el tenant en la platform DB (TenantRegistry)
 *
 * Variables de entorno requeridas:
 *   NEON_API_KEY, NEON_PROJECT_ID, NEON_BASE_URL
 *   APP_SECRET (para firmar el JWT de retorno)
 */
import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
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

// ─── Neon API ─────────────────────────────────────────────────────────────────

async function createNeonDatabase(dbName: string): Promise<{ poolerUrl: string; directUrl: string }> {
  const apiKey = process.env['NEON_API_KEY'];
  const projectId = process.env['NEON_PROJECT_ID'];
  const branchId = process.env['NEON_BRANCH_ID'];
  const dbOwner = process.env['NEON_DB_OWNER'] ?? 'neondb_owner';
  // NEON_DB_HOST: conexión PostgreSQL sin nombre de DB
  // ej: postgresql://neondb_owner:PASSWORD@ep-xxx.neon.tech
  const dbHost = process.env['NEON_DB_HOST'];

  if (!apiKey || !projectId || !branchId || !dbHost) {
    throw new Error('NEON_API_KEY, NEON_PROJECT_ID, NEON_BRANCH_ID y NEON_DB_HOST son requeridos');
  }

  const cleanHost = dbHost.replace(/\s+/g, '').replace(/\/$/, '');
  if (!cleanHost.startsWith('postgresql://') && !cleanHost.startsWith('postgres://')) {
    throw new Error(
      `NEON_DB_HOST inválido: debe empezar con "postgresql://" pero es "${cleanHost.slice(0, 20)}..." — revisá el valor en las variables de entorno.`,
    );
  }

  const res = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}/databases`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: { name: dbName, owner_name: dbOwner } }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Neon API error (${res.status}): ${body}`);
  }

  // URL pooler para uso normal (app connections).
  // URL directa (sin -pooler) para setup: migrations + seed DDL.
  const poolerUrl = `${cleanHost}/${dbName}?sslmode=require`;
  const directUrl = poolerUrl.replace(/-pooler\.([\w-]+\.aws\.neon\.tech)/, '.$1');
  return { poolerUrl, directUrl };
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
    await orm.getMigrator().up();
    console.log('[provision] migrations OK — seeding tenant + owner via raw SQL...');

    const conn = orm.em.getConnection();
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

    await conn.execute('BEGIN');
    try {
      await conn.execute(
        `INSERT INTO "tenants" (id, created_at, updated_at, name, slug, status, plan, tax_id, settings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tenantId, now, now, input.name, input.subdomain, TenantStatus.TRIAL, input.plan ?? TenantPlan.FREE, input.taxId ?? null, settings],
      );

      await conn.execute(
        `INSERT INTO "users" (id, created_at, updated_at, clerk_id, email, first_name, last_name,
          roles, is_active, two_factor_enabled, preferences, password_hash, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ownerId, now, now, ownerId, input.ownerEmail, input.ownerFirstName, input.ownerLastName,
          JSON.stringify([SystemRole.OWNER]), true, false,
          JSON.stringify({ theme: 'dark', language: 'es', timezone: input.timezone ?? 'America/Argentina/Buenos_Aires' }),
          passwordHash, tenantId],
      );

      await conn.execute(
        `INSERT INTO "subscriptions" (id, created_at, updated_at, tenant_id, plan, status, trial_ends_at, cancel_at_period_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [subId, now, now, tenantId, input.plan ?? TenantPlan.FREE, SubscriptionStatus.TRIALING, trialEndsAt, false],
      );

      await conn.execute('COMMIT');
    } catch (err) {
      await conn.execute('ROLLBACK');
      throw err;
    }

    console.log('[provision] seed OK — ownerId:', ownerId);
    return ownerId;
  } finally {
    await orm.close();
  }
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function provision(
  input: ProvisionInput,
  platformOrm: PlatformORM,
): Promise<ProvisionResult> {
  const { subdomain, name, ownerEmail } = input;
  const dbName = `inmob_${subdomain.replace(/-/g, '_')}`;

  const { poolerUrl, directUrl } = await createNeonDatabase(dbName);
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
