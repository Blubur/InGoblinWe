import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from './migrate';

export interface TempDatabase {
  pool: Pool;
  drop: () => Promise<void>;
}

/**
 * Crea una base de datos temporal con todas las migraciones aplicadas, para
 * pruebas de integración. Devuelve null (o la razón) si no hay PostgreSQL.
 */
export async function createTempDatabase(
  adminUrl: string | undefined,
): Promise<{ db: TempDatabase; skipReason?: undefined } | { db?: undefined; skipReason: string }> {
  if (!adminUrl) return { skipReason: 'DATABASE_URL no definida' };
  const name = `goblins_test_${randomBytes(4).toString('hex')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 2_000 });
  let pool: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    pool = new Pool({ connectionString: url.toString(), max: 4 });
    await runMigrations(pool);
  } catch (error) {
    await pool?.end().catch(() => undefined);
    await admin.end().catch(() => undefined);
    return { skipReason: `PostgreSQL no disponible: ${(error as Error).message}` };
  }
  return {
    db: {
      pool,
      drop: async () => {
        await pool!.end();
        await admin.query(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
        await admin.end();
      },
    },
  };
}
