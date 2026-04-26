import { MikroORM } from '@mikro-orm/postgresql';
import config from '../config.js';

const orm = await MikroORM.init(config);
const migrator = orm.getMigrator();
await migrator.down();
console.log('Platform migration rolled back.');
await orm.close();
