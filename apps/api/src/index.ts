import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '@inmob/database/config';
import { buildApp } from './app.js';

const dbUrl = process.env['DATABASE_URL'];
if (!dbUrl) {
  console.error('FATAL: DATABASE_URL no definida');
  process.exit(1);
}
console.log('DATABASE_URL primeros 40 chars:', JSON.stringify(dbUrl.slice(0, 40)));
console.log('DATABASE_URL largo total:', dbUrl.length);

const orm = await MikroORM.init(mikroOrmConfig);

const app = await buildApp({ orm });

const port = Number(process.env['PORT'] ?? 3001);
const host = process.env['HOST'] ?? '0.0.0.0';

await app.listen({ port, host });
app.log.info(`API running on http://${host}:${port}`);
