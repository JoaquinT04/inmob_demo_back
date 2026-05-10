import { createHash } from 'crypto';
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import {
  Tenant, User, Subscription, Property, Contact, Lead, Agenda, PortalConnection,
  RefreshToken, PasswordResetToken,
} from '@inmob/database';

const TENANT_ENTITIES = [
  Tenant, User, Subscription, Property, Contact, Lead, Agenda, PortalConnection,
  RefreshToken, PasswordResetToken,
];

class TenantConnectionManager {
  private cache = new Map<string, MikroORM>();

  private cacheKey(url: string): string {
    return createHash('sha256').update(url).digest('hex');
  }

  async get(databaseUrl: string): Promise<MikroORM> {
    const key = this.cacheKey(databaseUrl);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const orm = await MikroORM.init<PostgreSqlDriver>({
      driver: PostgreSqlDriver,
      clientUrl: databaseUrl,
      metadataProvider: TsMorphMetadataProvider,
      entities: TENANT_ENTITIES,
      debug: false,
      allowGlobalContext: false,
    });

    this.cache.set(key, orm);
    return orm;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.cache.values()].map(orm => orm.close()));
    this.cache.clear();
  }
}

export const connectionManager = new TenantConnectionManager();
