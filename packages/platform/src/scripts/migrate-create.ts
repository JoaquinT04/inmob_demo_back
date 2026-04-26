import { MikroORM } from '@mikro-orm/postgresql';
import config from '../config.js';

const orm = await MikroORM.init(config);
const migrator = orm.getMigrator();
const name = process.argv[2] ?? 'migration';
const initial = process.argv[3] === '--initial';

if (initial) {
  await migrator.createInitialMigration('./src/migrations');
} else {
  await migrator.createMigration(undefined, false, false, name);
}

console.log(`Migration created: ${name}`);
await orm.close();
