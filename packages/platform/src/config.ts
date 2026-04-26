import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import { Migrator } from '@mikro-orm/migrations';
import { TenantRegistry, HubProperty } from './entities/index.js';

const isSsl = process.env['PLATFORM_DATABASE_URL']?.includes('sslmode=require');

export default defineConfig({
  driver: PostgreSqlDriver,
  clientUrl: process.env['PLATFORM_DATABASE_URL'],
  driverOptions: isSsl ? { connection: { ssl: { rejectUnauthorized: false } } } : {},
  metadataProvider: TsMorphMetadataProvider,
  entities: [TenantRegistry, HubProperty],
  debug: process.env['NODE_ENV'] === 'development',
  extensions: [Migrator],
  migrations: {
    path: './src/migrations',
    pathTs: './src/migrations',
    glob: '!(*.d).{js,ts}',
  },
  allowGlobalContext: false,
});
