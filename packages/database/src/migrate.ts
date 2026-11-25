import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Pool } from 'pg';
import { describeError } from '@goblins/core';

export const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

const MIGRATION_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;
// Identificador arbitrario del bloqueo, para que dos procesos no migren a la vez.
const ADVISORY_LOCK_ID = 727274;

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface RunOptions {
  dir?: string;
  log?: (message: string) => void;
}

/** Windows puede entregar CRLF; se normaliza para que el checksum no dependa del sistema. */
function normalizeSql(sql: string): string {
  return sql.replace(/\r\n/g, '\n');
}

/**
 * Lee las migraciones del directorio, en orden. Falla si algún .sql no sigue el
 * patrón NNNN_nombre.sql o si dos migraciones comparten número: ignorarlas en
 * silencio dejaría la base de datos a medias sin que nadie se enterase.
 */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const sqlFiles = fs.readdirSync(dir).filter((file) => file.endsWith('.sql'));

  const invalid = sqlFiles.filter((file) => !MIGRATION_NAME.test(file));
  if (invalid.length > 0) {
    throw new Error(
      `Nombre de migración inválido: ${invalid.join(', ')}. Usa el formato NNNN_descripcion.sql (minúsculas, números y guion bajo).`,
    );
  }

  const seen = new Map<string, string>();
  for (const file of sqlFiles) {
    const prefix = MIGRATION_NAME.exec(file)![1]!;
    const other = seen.get(prefix);
    if (other) throw new Error(`Dos migraciones comparten el número ${prefix}: ${other} y ${file}.`);
    seen.set(prefix, file);
  }

  return sqlFiles.sort().map((name) => {
    const sql = normalizeSql(fs.readFileSync(path.join(dir, name), 'utf8'));
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

/**
 * Aplica las migraciones pendientes, cada una dentro de su propia transacción.
 * Las ya aplicadas se omiten; si su contenido cambió respecto a lo aplicado, se aborta.
 */
export async function runMigrations(pool: Pool, options: RunOptions = {}): Promise<MigrationResult> {
  const log = options.log ?? (() => undefined);
  const migrations = loadMigrations(options.dir);

  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_ID})`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const existing = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const known = new Map(existing.rows.map((row) => [row.name, row.checksum]));

    for (const migration of migrations) {
      const knownChecksum = known.get(migration.name);
      if (knownChecksum !== undefined) {
        if (knownChecksum !== migration.checksum) {
          throw new Error(
            `La migración ${migration.name} ya estaba aplicada pero su contenido ha cambiado. Las migraciones aplicadas no se editan: crea una nueva.`,
          );
        }
        skipped.push(migration.name);
        continue;
      }

      log(`aplicando ${migration.name}`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`La migración ${migration.name} falló y se deshizo: ${describeError(error)}`, {
          cause: error,
        });
      }
      applied.push(migration.name);
    }

    return { applied, skipped };
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`);
    } catch {
      // Si la conexión murió, el bloqueo se libera solo al cerrarse la sesión.
    }
    client.release();
  }
}
