import 'dotenv/config';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '../config.js';

const orm = await MikroORM.init(config);
const migrator = orm.getMigrator();
await migrator.up();
console.log('Migrations applied.');
await orm.close();
