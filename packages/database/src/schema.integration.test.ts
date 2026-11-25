import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { loadRootEnv } from '@goblins/core';
import { findCommunityByHost } from './communities';
import { runMigrations } from './migrate';

/**
 * Prueba contra PostgreSQL real en una base temporal. Si no hay base de datos
 * disponible, se omite (el resumen de pruebas lo mostrará como "skipped").
 */
loadRootEnv();
const adminUrl = process.env.DATABASE_URL;
const tempName = `goblins_test_${randomBytes(4).toString('hex')}`;
let admin: Pool | undefined;
let pool: Pool | undefined;
let skipReason: string | undefined = adminUrl ? undefined : 'DATABASE_URL no definida';

before(async () => {
  if (!adminUrl) return;
  try {
    admin = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 2_000 });
    await admin.query(`CREATE DATABASE ${tempName}`);
    const url = new URL(adminUrl);
    url.pathname = `/${tempName}`;
    pool = new Pool({ connectionString: url.toString(), max: 2 });
    await runMigrations(pool);
  } catch (error) {
    skipReason = `PostgreSQL no disponible: ${(error as Error).message}`;
  }
});

after(async () => {
  await pool?.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${tempName}`).catch(() => undefined);
    await admin.end();
  }
});

/** Omite la prueba (en tiempo de ejecución, cuando ya se sabe si hay base de datos). */
function skipIfNoDb(t: TestContext): boolean {
  if (!skipReason) return false;
  t.skip(skipReason);
  return true;
}

async function rejects(sql: string, params: unknown[], code: string): Promise<void> {
  await assert.rejects(pool!.query(sql, params), (error: { code?: string }) => error.code === code);
}

const UNIQUE = '23505';
const CHECK = '23514';

test('usuarios: el email debe ser único, en minúsculas y con forma válida', async (t) => {
  if (skipIfNoDb(t)) return;
  const ins = `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Ana', 'x')`;
  await pool!.query(ins, ['ana@example.com']);
  await rejects(ins, ['ana@example.com'], UNIQUE);
  await rejects(ins, ['Ana@Example.com'], CHECK);
  await rejects(ins, ['sin-arroba'], CHECK);
});

test('membresías: una por usuario y comunidad, y se borran en cascada', async (t) => {
  if (skipIfNoDb(t)) return;
  const c = await pool!.query(`INSERT INTO communities (slug, name) VALUES ('foro-a', 'A') RETURNING id`);
  const u = await pool!.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ('b@example.com', 'B', 'x') RETURNING id`,
  );
  const ins = `INSERT INTO memberships (community_id, user_id) VALUES ($1, $2)`;
  await pool!.query(ins, [c.rows[0].id, u.rows[0].id]);
  await rejects(ins, [c.rows[0].id, u.rows[0].id], UNIQUE);

  await pool!.query(`DELETE FROM communities WHERE id = $1`, [c.rows[0].id]);
  const left = await pool!.query(`SELECT count(*)::int AS n FROM memberships`);
  assert.equal(left.rows[0].n, 0);
});

test('sesiones: token único, caducidad posterior a la creación y cascada', async (t) => {
  if (skipIfNoDb(t)) return;
  const u = await pool!.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ('c@example.com', 'C', 'x') RETURNING id`,
  );
  const ins = `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`;
  await pool!.query(ins, ['hash1', u.rows[0].id]);
  await rejects(ins, ['hash1', u.rows[0].id], UNIQUE);
  await rejects(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h2', $1, now() - interval '1 day')`,
    [u.rows[0].id],
    CHECK,
  );

  await pool!.query(`DELETE FROM users WHERE id = $1`, [u.rows[0].id]);
  const left = await pool!.query(`SELECT count(*)::int AS n FROM sessions`);
  assert.equal(left.rows[0].n, 0);
});

test('findCommunityByHost: encuentra por host exacto y devuelve el estado', async (t) => {
  if (skipIfNoDb(t)) return;
  const a = await pool!.query(`INSERT INTO communities (slug, name) VALUES ('res-a', 'Res A') RETURNING id`);
  const b = await pool!.query(
    `INSERT INTO communities (slug, name, status) VALUES ('res-b', 'Res B', 'suspended') RETURNING id`,
  );
  await pool!.query(
    `INSERT INTO community_domains (community_id, host, is_primary) VALUES ($1, 'res-a.localhost', true), ($2, 'res-b.localhost', true)`,
    [a.rows[0].id, b.rows[0].id],
  );

  const found = await findCommunityByHost(pool!, 'res-a.localhost');
  assert.equal(found?.id, a.rows[0].id);
  assert.equal(found?.status, 'active');
  assert.equal((await findCommunityByHost(pool!, 'res-b.localhost'))?.status, 'suspended');
  assert.equal(await findCommunityByHost(pool!, 'nadie.localhost'), null);
  // Un host que solo es prefijo o sufijo de otro no debe coincidir.
  assert.equal(await findCommunityByHost(pool!, 'res-a.localhost.evil.com'), null);
  assert.equal(await findCommunityByHost(pool!, 'res-a'), null);
});
