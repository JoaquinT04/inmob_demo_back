import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '@inmob/database/config';
import { buildApp } from './app.js';

const orm = await MikroORM.init(mikroOrmConfig);

const app = await buildApp({ orm });

const port = Number(process.env['PORT'] ?? 3001);
const host = process.env['HOST'] ?? '0.0.0.0';

await app.listen({ port, host });
app.log.info(`API running on http://${host}:${port}`);
