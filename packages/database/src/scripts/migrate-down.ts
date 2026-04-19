import 'dotenv/config';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../config.js';

const orm = await MikroORM.init(config);
const migrator = orm.getMigrator();
await migrator.down();
console.log('Rolled back one migration.');
await orm.close();
