/**
 * Seed de la platform DB para desarrollo.
 * Registra manualmente los tenants de demo sin hacer provisioning real.
 *
 * Útil para desarrollo local donde ya creaste las DBs a mano.
 *
 * Ejecutar: pnpm platform:seed
 */
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../config.js';
import { TenantRegistry } from '../entities/index.js';
import { TenantPlan, TenantStatus, SubscriptionStatus } from '@inmob/shared';

const orm = await MikroORM.init(config);
const em = orm.em.fork();

const trialEndsAt = new Date();
trialEndsAt.setDate(trialEndsAt.getDate() + 30);

const demoTenants = [
  {
    subdomain: 'demo',
    name: 'Inmobiliaria Demo',
    ownerEmail: 'owner@demo.com',
    databaseUrl: process.env['DATABASE_URL'] ?? 'postgresql://inmob:inmob_pass@localhost:5432/inmob_db',
  },
];

for (const t of demoTenants) {
  const existing = await em.findOne(TenantRegistry, { subdomain: t.subdomain });
  if (existing) {
    console.log(`Tenant "${t.subdomain}" ya registrado en platform.`);
    continue;
  }

  em.create(TenantRegistry, {
    ...t,
    plan: TenantPlan.FREE,
    status: TenantStatus.TRIAL,
    subscriptionStatus: SubscriptionStatus.TRIALING,
    trialEndsAt,
  });
  console.log(`Tenant "${t.subdomain}" registrado → ${t.databaseUrl}`);
}

await em.flush();
console.log('\nPlatform seed completo.');
await orm.close();
