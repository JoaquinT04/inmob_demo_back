/**
 * Seed de desarrollo — crea una inmobiliaria demo con usuarios de prueba.
 *
 * Ejecutar: pnpm db:seed
 *
 * Crea:
 *   tenant:  inmob-demo / "Inmobiliaria Demo"
 *   users:   owner, administrador, coordinador, agente, captador
 *   subscription: trial activo (14 días)
 */
import { MikroORM } from '@mikro-orm/postgresql';
import bcrypt from 'bcryptjs';
import config from '../config.js';
import { Tenant, User, Subscription } from '../entities/index.js';
import { TenantStatus, TenantPlan, SubscriptionStatus, SystemRole } from '@inmob/shared';

const orm = await MikroORM.init(config);
const em = orm.em.fork();

const TENANT_SLUG = process.env['DEV_TENANT_SLUG'] ?? 'inmob-demo';
const TRIAL_DAYS = Number(process.env['TRIAL_DAYS'] ?? 14);

const existing = await em.findOne(Tenant, { slug: TENANT_SLUG });
if (existing) {
  console.log(`Tenant "${TENANT_SLUG}" ya existe. Nada que hacer.`);
  await orm.close();
  process.exit(0);
}

const tenant = em.create(Tenant, {
  name: 'Inmobiliaria Demo',
  slug: TENANT_SLUG,
  status: TenantStatus.TRIAL,
  plan: TenantPlan.FREE,
  settings: {
    locale: {
      country: 'AR',
      language: 'es',
      timezone: 'America/Argentina/Buenos_Aires',
      currency: 'ARS',
    },
  },
});

const trialEndsAt = new Date();
trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

const subscription = em.create(Subscription, {
  tenant: tenant as never,
  plan: TenantPlan.FREE,
  status: SubscriptionStatus.TRIALING,
  trialEndsAt,
  cancelAtPeriodEnd: false,
});

const users: Array<{ email: string; firstName: string; lastName: string; role: SystemRole; password: string }> = [
  { email: 'owner@demo.com',         firstName: 'Owner',    lastName: 'Demo',    role: SystemRole.OWNER,         password: 'owner123' },
  { email: 'admin@demo.com',         firstName: 'Admin',    lastName: 'Demo',    role: SystemRole.ADMINISTRADOR, password: 'admin123' },
  { email: 'coordinador@demo.com',   firstName: 'Coord',    lastName: 'Demo',    role: SystemRole.COORDINADOR,   password: 'coord123' },
  { email: 'agente@demo.com',        firstName: 'Agente',   lastName: 'Demo',    role: SystemRole.AGENTE,        password: 'agente123' },
  { email: 'captador@demo.com',      firstName: 'Captador', lastName: 'Demo',    role: SystemRole.CAPTADOR,      password: 'capt123' },
];

const createdUsers: User[] = [];
for (const u of users) {
  const tempId = crypto.randomUUID();
  const user = em.create(User, {
    clerkId: tempId, // Se actualiza con el ID real tras el flush
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    roles: [u.role],
    isActive: true,
    twoFactorEnabled: false,
    preferences: { theme: 'dark', language: 'es', timezone: 'America/Argentina/Buenos_Aires' },
    tenant: tenant as never,
    passwordHash: await bcrypt.hash(u.password, 10),
  });
  createdUsers.push(user);
}

await em.flush();

// Sincronizar clerkId con el ID real generado por la DB
for (const user of createdUsers) {
  user.clerkId = user.id;
}
await em.flush();

console.log(`\nTenant "${TENANT_SLUG}" creado.`);
console.log(`Trial: hasta ${trialEndsAt.toLocaleDateString('es-AR')}\n`);
console.log('Usuarios disponibles (POST /api/auth/login):');
for (const u of users) {
  console.log(`  ${u.role.padEnd(15)} → ${u.email} / ${u.password}`);
}
console.log(`\ntenantSlug: ${TENANT_SLUG}`);

await orm.close();
