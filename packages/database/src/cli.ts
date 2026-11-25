import { describeError, loadRootEnv, parseDatabaseUrl } from '@goblins/core';
import { createPool } from './client';
import { runMigrations } from './migrate';

async function main(): Promise<void> {
  loadRootEnv();
  const pool = createPool(parseDatabaseUrl(process.env));
  try {
    const result = await runMigrations(pool, { log: (message) => console.log(`[migrate] ${message}`) });
    console.log(
      `[migrate] listo: ${result.applied.length} aplicada(s), ${result.skipped.length} ya estaba(n) aplicada(s).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(`[migrate] ${describeError(error)}`);
  process.exitCode = 1;
});
