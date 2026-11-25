import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Pool } from 'pg';
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from './migrate';

function withTempDir<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goblins-mig-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withTempDirAsync<T>(
  files: Record<string, string>,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goblins-mig-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content);
    }
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Pool falso que registra las consultas, sin necesitar PostgreSQL. */
function fakePool(options: { applied?: Record<string, string>; failOn?: string } = {}) {
  const calls: string[] = [];
  const state = { released: false };
  const client = {
    async query(text: string) {
      calls.push(text.trim());
      if (text.startsWith('SELECT name, checksum')) {
        return {
          rows: Object.entries(options.applied ?? {}).map(([name, checksum]) => ({ name, checksum })),
        };
      }
      if (options.failOn && text.includes(options.failOn)) throw new Error('boom');
      return { rows: [] };
    },
    release() {
      state.released = true;
    },
  };
  const pool = { connect: async () => client } as unknown as Pool;
  return { pool, calls, state };
}

test('la carpeta real de migraciones se carga y empieza por 0001', () => {
  const migrations = loadMigrations(MIGRATIONS_DIR);
  assert.ok(migrations.length >= 1);
  assert.ok(migrations[0]!.name.startsWith('0001_'));
  assert.ok(migrations[0]!.sql.includes('CREATE TABLE communities'));
});

test('ordena por número y normaliza CRLF en el checksum', () => {
  const lf = withTempDir({ '0002_b.sql': 'SELECT 2;\n', '0001_a.sql': 'SELECT 1;\n' }, (dir) =>
    loadMigrations(dir),
  );
  const crlf = withTempDir({ '0001_a.sql': 'SELECT 1;\r\n' }, (dir) => loadMigrations(dir));
  assert.deepEqual(lf.map((m) => m.name), ['0001_a.sql', '0002_b.sql']);
  assert.equal(lf[0]!.checksum, crlf[0]!.checksum);
});

test('rechaza archivos .sql con nombre inválido', () => {
  withTempDir({ '1-mal.sql': 'SELECT 1;' }, (dir) => {
    assert.throws(() => loadMigrations(dir), /Nombre de migración inválido/);
  });
});

test('rechaza dos migraciones con el mismo número', () => {
  withTempDir({ '0001_a.sql': 'SELECT 1;', '0001_b.sql': 'SELECT 2;' }, (dir) => {
    assert.throws(() => loadMigrations(dir), /comparten el número 0001/);
  });
});

test('aplica las pendientes en orden, cada una en su transacción', async () => {
  await withTempDirAsync({ '0001_a.sql': 'SELECT 1;', '0002_b.sql': 'SELECT 2;' }, async (dir) => {
    const { pool, calls, state } = fakePool();
    const result = await runMigrations(pool, { dir });
    assert.deepEqual(result.applied, ['0001_a.sql', '0002_b.sql']);
    assert.equal(calls.filter((c) => c === 'BEGIN').length, 2);
    assert.equal(calls.filter((c) => c === 'COMMIT').length, 2);
    assert.equal(state.released, true);
  });
});

test('omite las ya aplicadas con el mismo checksum', async () => {
  await withTempDirAsync({ '0001_a.sql': 'SELECT 1;' }, async (dir) => {
    const [migration] = loadMigrations(dir);
    const { pool, calls } = fakePool({ applied: { '0001_a.sql': migration!.checksum } });
    const result = await runMigrations(pool, { dir });
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.skipped, ['0001_a.sql']);
    assert.ok(!calls.includes('BEGIN'));
  });
});

test('aborta si una migración aplicada fue modificada', async () => {
  await withTempDirAsync({ '0001_a.sql': 'SELECT 1;' }, async (dir) => {
    const { pool, state } = fakePool({ applied: { '0001_a.sql': 'checksum-antiguo' } });
    await assert.rejects(runMigrations(pool, { dir }), /su contenido ha cambiado/);
    assert.equal(state.released, true);
  });
});

test('si una migración falla, hace ROLLBACK y no hace COMMIT', async () => {
  await withTempDirAsync({ '0001_a.sql': 'SELECT FAIL_HERE;' }, async (dir) => {
    const { pool, calls, state } = fakePool({ failOn: 'FAIL_HERE' });
    await assert.rejects(runMigrations(pool, { dir }), /falló y se deshizo/);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('COMMIT'));
    assert.equal(state.released, true);
  });
});
