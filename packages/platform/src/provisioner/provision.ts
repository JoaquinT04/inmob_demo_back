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
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { Migrator } from '@mikro-orm/migrations';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import tenantDbConfig from '@inmob/database/config';
import { User, Tenant } from '@inmob/database';
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

async function createNeonDatabase(dbName: string): Promise<string> {
  const apiKey = process.env['NEON_API_KEY'];
  const projectId = process.env['NEON_PROJECT_ID'];
  const dbOwner = process.env['NEON_DB_OWNER'] ?? 'neondb_owner';
  // NEON_DB_HOST: conexión PostgreSQL sin nombre de DB
  // ej: postgresql://neondb_owner:PASSWORD@ep-xxx.neon.tech
  const dbHost = process.env['NEON_DB_HOST'];

  if (!apiKey || !projectId || !dbHost) {
    throw new Error('NEON_API_KEY, NEON_PROJECT_ID y NEON_DB_HOST son requeridos');
  }

  const res = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/databases`,
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

  return `${dbHost}/${dbName}?sslmode=require&channel_binding=require`;
}

// ─── Migrations en la nueva DB ────────────────────────────────────────────────

async function runTenantMigrations(databaseUrl: string): Promise<void> {
  const orm = await MikroORM.init({ ...tenantDbConfig, clientUrl: databaseUrl });
  try {
    await orm.getMigrator().up();
  } finally {
    await orm.close();
  }
}

// ─── Crear Tenant + owner en la nueva DB ─────────────────────────────────────

async function createTenantOwner(
  databaseUrl: string,
  input: ProvisionInput,
): Promise<string> {
  const isSsl = databaseUrl.includes('sslmode=require');
  const orm = await MikroORM.init({
    ...tenantDbConfig,
    clientUrl: databaseUrl,
    driverOptions: isSsl ? { connection: { ssl: { rejectUnauthorized: false } } } : {},
    metadataProvider: TsMorphMetadataProvider,
    extensions: [Migrator],
  });

  const em = orm.em.fork();
  let ownerId: string;

  await em.begin();
  try {
    const tenant = em.create(Tenant, {
      name: input.name,
      slug: input.subdomain,
      status: TenantStatus.TRIAL,
      plan: input.plan ?? TenantPlan.FREE,
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

    const passwordHash = await bcrypt.hash(input.password, 10);
    const tempId = crypto.randomUUID();

    const owner = em.create(User, {
      clerkId: tempId,
      email: input.ownerEmail,
      firstName: input.ownerFirstName,
      lastName: input.ownerLastName,
      roles: [SystemRole.OWNER],
      isActive: true,
      twoFactorEnabled: false,
      preferences: {
        theme: 'dark',
        language: 'es',
        timezone: input.timezone ?? 'America/Argentina/Buenos_Aires',
      },
      tenant: tenant as never,
      passwordHash,
    });

    await em.flush();
    owner.clerkId = owner.id;
    ownerId = owner.id;
    await em.flush();
    await em.commit();
  } catch (err) {
    await em.rollback();
    throw err;
  } finally {
    await orm.close();
  }

  return ownerId!;
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function provision(
  input: ProvisionInput,
  platformOrm: PlatformORM,
): Promise<ProvisionResult> {
  const { subdomain, name, ownerEmail } = input;
  const dbName = `inmob_${subdomain.replace(/-/g, '_')}`;

  const databaseUrl = await createNeonDatabase(dbName);
  await runTenantMigrations(databaseUrl);
  const ownerId = await createTenantOwner(databaseUrl, input);

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + Number(process.env['TRIAL_DAYS'] ?? 30));

  const em = platformOrm.em.fork();
  em.create(TenantRegistry, {
    subdomain,
    name,
    ownerEmail,
    databaseUrl,
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

  return { subdomain, databaseUrl, ownerId, token };
}
