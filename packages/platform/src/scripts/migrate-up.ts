import { MikroORM } from '@mikro-orm/postgresql';
import config from '../config.js';

const orm = await MikroORM.init(config);
const migrator = orm.getMigrator();
await migrator.up();
console.log('Platform migrations applied.');
await orm.close();
