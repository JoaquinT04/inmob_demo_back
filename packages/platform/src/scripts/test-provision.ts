/**
 * Script de test para el provisioner.
 *
 * Modos de uso:
 *
 *   # Modo FULL (crea DB en Neon + migra + crea tenant + registra en Platform DB)
 *   pnpm --filter @inmob/platform tsx src/scripts/test-provision.ts full
 *
 *   # Modo SKIP_NEON (usa DB_URL que ya existe, útil para testear sin Neon API)
 *   TENANT_DB_URL=postgresql://... pnpm --filter @inmob/platform tsx src/scripts/test-provision.ts skip-neon
 *
 * Variables de entorno requeridas:
 *   - PLATFORM_DATABASE_URL        (siempre)
 *   - APP_SECRET                   (siempre)
 *   - En modo FULL: NEON_API_KEY, NEON_PROJECT_ID, NEON_BRANCH_ID, NEON_DB_HOST
 *   - En modo skip-neon: TENANT_DB_URL (la URL de la DB ya existente)
 */
import { MikroORM } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { Migrator } from '@mikro-orm/migrations';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

import platformConfig from '../config.js';
import tenantDbConfig from '@inmob/database/config';
import { User, Tenant } from '@inmob/database';
import { TenantPlan, TenantStatus, SystemRole, SubscriptionStatus } from '@inmob/shared';
import { TenantRegistry } from '../entities/index.js';

const mode = process.argv[2] ?? 'full';

const input = {
  subdomain: `test-${Date.now()}`,
  name: 'Inmobiliaria Test Automatizado',
  ownerEmail: `test-${Date.now()}@example.com`,
  ownerFirstName: 'Test',
  ownerLastName: 'Owner',
  password: 'test123456',
  country: 'AR',
  timezone: 'America/Argentina/Buenos_Aires',
  plan: TenantPlan.FREE,
};

console.log('\n── Test Provisioner ────────────────────────────────────────');
console.log('Modo:', mode);
console.log('Subdomain:', input.subdomain);
console.log('────────────────────────────────────────────────────────────\n');

// ─── 1. Platform ORM ──────────────────────────────────────────────────────────

console.log('[1/5] Conectando a Platform DB...');
const platformOrm = await MikroORM.init(platformConfig);
console.log('      OK');

// ─── 2. Crear DB en Neon (modo full) o usar la existente (modo skip-neon) ─────

let databaseUrl: string;

if (mode === 'skip-neon') {
  databaseUrl = process.env['TENANT_DB_URL'] ?? '';
  if (!databaseUrl) {
    console.error('ERROR: TENANT_DB_URL es requerida en modo skip-neon');
    process.exit(1);
  }
  console.log('[2/5] SKIP: usando DB URL existente');
} else {
  console.log('[2/5] Creando base de datos en Neon...');
  const apiKey = process.env['NEON_API_KEY'];
  const projectId = process.env['NEON_PROJECT_ID'];
  const branchId = process.env['NEON_BRANCH_ID'];
  const dbHost = process.env['NEON_DB_HOST'];

  if (!apiKey || !projectId || !branchId || !dbHost) {
    console.error('Faltan vars: NEON_API_KEY, NEON_PROJECT_ID, NEON_BRANCH_ID, NEON_DB_HOST');
    console.error('Probá: tsx src/scripts/test-provision.ts skip-neon con TENANT_DB_URL=...');
    process.exit(1);
  }

  const dbName = `inmob_${input.subdomain.replace(/-/g, '_')}`;
  const res = await fetch(
    `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}/databases`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: { name: dbName, owner_name: process.env['NEON_DB_OWNER'] ?? 'neondb_owner' } }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`Neon API error (${res.status}):`, body);
    process.exit(1);
  }

  const host = dbHost.replace(/\s+/g, '').replace(/\/$/, '');
  databaseUrl = `${host}/${dbName}?sslmode=require`;
  console.log('      DB creada:', dbName);
}

// ─── 3. Migrations en la nueva DB ────────────────────────────────────────────

console.log('[3/5] Corriendo migrations en la tenant DB...');
const isSsl = databaseUrl.includes('sslmode=require');
const tenantOrm = await MikroORM.init({
  ...tenantDbConfig,
  clientUrl: databaseUrl,
  driverOptions: isSsl ? { connection: { ssl: { rejectUnauthorized: false } } } : {},
});
await tenantOrm.getMigrator().up();
console.log('      OK');

// ─── 4. Crear Tenant + owner ─────────────────────────────────────────────────

console.log('[4/5] Creando Tenant + usuario owner...');
const tenantOrmFull = await MikroORM.init({
  ...tenantDbConfig,
  clientUrl: databaseUrl,
  driverOptions: isSsl ? { connection: { ssl: { rejectUnauthorized: false } } } : {},
  metadataProvider: TsMorphMetadataProvider,
  extensions: [Migrator],
});

const em = tenantOrmFull.em.fork();
let ownerId: string;

await em.begin();
try {
  const tenant = em.create(Tenant, {
    name: input.name,
    slug: input.subdomain,
    status: TenantStatus.TRIAL,
    plan: input.plan,
    settings: {
      locale: {
        country: input.country,
        language: 'es',
        timezone: input.timezone,
        currency: 'ARS',
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
    preferences: { theme: 'dark', language: 'es', timezone: input.timezone },
    tenant: tenant as never,
    passwordHash,
  });

  await em.flush();
  owner.clerkId = owner.id;
  ownerId = owner.id;
  await em.flush();
  await em.commit();
  console.log('      Owner ID:', ownerId);
} catch (err) {
  await em.rollback();
  throw err;
} finally {
  await tenantOrmFull.close();
}

// ─── 5. Registrar en Platform DB ─────────────────────────────────────────────

console.log('[5/5] Registrando en Platform DB (TenantRegistry)...');
const trialEndsAt = new Date();
trialEndsAt.setDate(trialEndsAt.getDate() + 30);

const platformEm = platformOrm.em.fork();
platformEm.create(TenantRegistry, {
  subdomain: input.subdomain,
  name: input.name,
  ownerEmail: input.ownerEmail,
  databaseUrl,
  plan: input.plan,
  status: TenantStatus.TRIAL,
  subscriptionStatus: SubscriptionStatus.TRIALING,
  trialEndsAt,
});
await platformEm.flush();
console.log('      OK — tenant registrado');

// ─── JWT ──────────────────────────────────────────────────────────────────────

const secret = new TextEncoder().encode(
  process.env['APP_SECRET'] ?? 'dev-secret-inmob-change-in-production-32chars',
);
const token = await new SignJWT({ userId: ownerId!, subdomain: input.subdomain })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('7d')
  .sign(secret);

await platformOrm.close();

console.log('\n── Resultado ───────────────────────────────────────────────');
console.log('subdomain:  ', input.subdomain);
console.log('databaseUrl:', databaseUrl.replace(/:\/\/[^@]+@/, '://***@'));
console.log('token:      ', token.slice(0, 40) + '...');
console.log('\n¡Provisioning OK!\n');
