import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '@inmob/database/config';
import platformConfig from '@inmob/platform/config';
import { buildApp } from './app.js';
import { connectionManager } from './lib/connection-manager.js';

const orm = await MikroORM.init(mikroOrmConfig);
const platformOrm = await MikroORM.init(platformConfig);

const app = await buildApp({ orm, platformOrm });

const port = Number(process.env['PORT'] ?? 3001);
const host = process.env['HOST'] ?? '0.0.0.0';

await app.listen({ port, host });
app.log.info(`API running on http://${host}:${port}`);

const shutdown = async () => {
  await app.close();
  await orm.close();
  await platformOrm.close();
  await connectionManager.closeAll();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
