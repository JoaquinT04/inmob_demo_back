import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });
import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { Migrator } from '@mikro-orm/migrations';
import {
  Tenant,
  User,
  Subscription,
  Property,
  Contact,
  Lead,
  Agenda,
  PortalConnection,
} from './entities/index.js';

export default defineConfig({
  driver: PostgreSqlDriver,
  clientUrl: process.env['DATABASE_URL'],
  metadataProvider: TsMorphMetadataProvider,
  entities: [Tenant, User, Subscription, Property, Contact, Lead, Agenda, PortalConnection],
  debug: process.env['NODE_ENV'] === 'development',
  extensions: [Migrator],
  migrations: {
    path: './src/migrations',
    pathTs: './src/migrations',
    glob: '!(*.d).{js,ts}',
  },
  allowGlobalContext: false,
});
