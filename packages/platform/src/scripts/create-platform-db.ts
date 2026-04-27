/**
 * Crea la base de datos inmob_platform en el mismo servidor Neon que DATABASE_URL.
 *
 * Uso:
 *   pnpm --filter @inmob/platform tsx src/scripts/create-platform-db.ts
 *
 * Qué hace:
 *   1. Se conecta al servidor Neon usando DATABASE_URL pero a la DB "neondb" (o la que tengas)
 *   2. Crea la base de datos "inmob_platform" si no existe
 *   3. Imprime la PLATFORM_DATABASE_URL resultante para agregar al .env
 */
import pg from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../../.env') });

const sourceUrl = process.env['DATABASE_URL'];
if (!sourceUrl) {
  console.error('DATABASE_URL no está configurado en .env');
  process.exit(1);
}

// Derivar la URL de la platform DB reemplazando el nombre de la DB
// ej: .../neondb?sslmode=require → .../inmob_platform?sslmode=require
const platformUrl = sourceUrl.replace(/\/([^/?]+)(\?|$)/, '/inmob_platform$2');

console.log('\n── Crear Platform DB ────────────────────────────────────────');
console.log('Source URL:  ', sourceUrl.replace(/:\/\/[^@]+@/, '://***@'));
console.log('Platform URL:', platformUrl.replace(/:\/\/[^@]+@/, '://***@'));
console.log('─────────────────────────────────────────────────────────────\n');

// En Neon no podemos hacer CREATE DATABASE desde una conexión existente
// (Neon usa "autocrear" la DB si se especifica en la URL, pero en realidad
// sí permite crear via SQL si tenemos permisos suficientes)
// Intentamos conectar a "postgres" o a la DB fuente para crear inmob_platform

const client = new pg.Client({
  connectionString: sourceUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

// Verificar si ya existe
const { rows } = await client.query(
  `SELECT 1 FROM pg_database WHERE datname = 'inmob_platform'`,
);

if (rows.length > 0) {
  console.log('La base de datos "inmob_platform" ya existe.');
} else {
  // En Neon esto puede fallar si no tenemos permisos — en ese caso crear desde la consola
  try {
    await client.query('CREATE DATABASE inmob_platform');
    console.log('✓ Base de datos "inmob_platform" creada exitosamente.');
  } catch (err) {
    if ((err as { code?: string }).code === '42501') {
      console.error('Sin permisos para CREATE DATABASE en este servidor Neon.');
      console.error('Creá la DB manualmente desde la consola de Neon (console.neon.tech)');
      console.error('Nombre: inmob_platform');
      console.error('Owner:  neondb_owner');
    } else {
      console.error('Error al crear DB:', err);
    }
    await client.end();
    process.exit(1);
  }
}

await client.end();

console.log('\n── Agregá esto a tu .env ────────────────────────────────────');
console.log(`PLATFORM_DATABASE_URL=${platformUrl}`);
console.log('─────────────────────────────────────────────────────────────\n');
console.log('Después corré: pnpm platform:migrate\n');
