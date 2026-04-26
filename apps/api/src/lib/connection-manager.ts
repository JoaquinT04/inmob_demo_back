import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import {
  Tenant, User, Subscription, Property, Contact, Lead, Agenda, PortalConnection,
} from '@inmob/database';

const TENANT_ENTITIES = [Tenant, User, Subscription, Property, Contact, Lead, Agenda, PortalConnection];

class TenantConnectionManager {
  private cache = new Map<string, MikroORM>();

  async get(databaseUrl: string): Promise<MikroORM> {
    const cached = this.cache.get(databaseUrl);
    if (cached) return cached;

    const isSsl = databaseUrl.includes('sslmode=require');
    const orm = await MikroORM.init<PostgreSqlDriver>({
      driver: PostgreSqlDriver,
      clientUrl: databaseUrl,
      driverOptions: isSsl ? { connection: { ssl: { rejectUnauthorized: false } } } : {},
      metadataProvider: TsMorphMetadataProvider,
      entities: TENANT_ENTITIES,
      debug: false,
      allowGlobalContext: false,
    });

    this.cache.set(databaseUrl, orm);
    return orm;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.cache.values()].map(orm => orm.close()));
    this.cache.clear();
  }
}

export const connectionManager = new TenantConnectionManager();
