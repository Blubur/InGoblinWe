import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { loadRootEnv } from '@goblins/core';
import {
  createCommunity,
  findCommunityByHost,
  listCommunities,
  setCommunityStatus,
} from './communities';
import { createTempDatabase, type TempDatabase } from './testing';

loadRootEnv();

let temp: TempDatabase | undefined;
let skipReason: string | undefined;

before(async () => {
  const created = await createTempDatabase(process.env.DATABASE_URL);
  if (!created.db) {
    skipReason = created.skipReason;
    return;
  }
  temp = created.db;
});

after(async () => {
  await temp?.drop();
});

function skipIfNoDb(t: TestContext): boolean {
  if (!skipReason) return false;
  t.skip(skipReason);
  return true;
}

async function newUser(email: string): Promise<string> {
  const r = await temp!.pool.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Persona', 'x') RETURNING id`,
    [email],
  );
  return r.rows[0].id;
}

test('createCommunity crea comunidad, dominio principal y administrador', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  const adminId = await newUser('admin1@example.com');
  const result = await createCommunity(pool, {
    slug: 'uno',
    name: 'Foro Uno',
    host: 'uno.goblins.test',
    adminUserId: adminId,
  });
  assert.ok(result.ok);
  assert.equal(result.community.slug, 'uno');
  assert.equal(result.community.status, 'active');

  const found = await findCommunityByHost(pool, 'uno.goblins.test');
  assert.equal(found?.id, result.community.id);

  const domain = await pool.query(`SELECT is_primary FROM community_domains WHERE community_id = $1`, [
    result.community.id,
  ]);
  assert.equal(domain.rowCount, 1);
  assert.equal(domain.rows[0].is_primary, true);

  const membership = await pool.query(`SELECT role FROM memberships WHERE community_id = $1 AND user_id = $2`, [
    result.community.id,
    adminId,
  ]);
  assert.equal(membership.rows[0].role, 'admin');
});

test('createCommunity sin administrador crea solo comunidad y dominio', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  const result = await createCommunity(pool, { slug: 'sin-admin', name: 'Sin admin', host: 'sin-admin.goblins.test' });
  assert.ok(result.ok);
  const members = await pool.query(`SELECT count(*)::int AS n FROM memberships WHERE community_id = $1`, [
    result.community.id,
  ]);
  assert.equal(members.rows[0].n, 0);
});

test('createCommunity: slug repetido devuelve slug_taken y no deja nada a medias', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  await createCommunity(pool, { slug: 'repetido', name: 'A', host: 'repetido.goblins.test' });
  const again = await createCommunity(pool, { slug: 'repetido', name: 'B', host: 'otro.goblins.test' });
  assert.deepEqual(again, { ok: false, reason: 'slug_taken' });
  assert.equal(await findCommunityByHost(pool, 'otro.goblins.test'), null);
});

test('createCommunity: host ya registrado devuelve host_taken y revierte la comunidad', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  await createCommunity(pool, { slug: 'dueno-del-host', name: 'A', host: 'compartido.goblins.test' });
  const result = await createCommunity(pool, { slug: 'nueva-sin-host', name: 'B', host: 'compartido.goblins.test' });
  assert.deepEqual(result, { ok: false, reason: 'host_taken' });
  const leftover = await pool.query(`SELECT 1 FROM communities WHERE slug = 'nueva-sin-host'`);
  assert.equal(leftover.rowCount, 0);
});

test('createCommunity: si falla la membresía se revierte todo', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  await assert.rejects(
    createCommunity(pool, {
      slug: 'admin-fantasma',
      name: 'X',
      host: 'admin-fantasma.goblins.test',
      adminUserId: '00000000-0000-0000-0000-000000000000',
    }),
  );
  const leftover = await pool.query(`SELECT 1 FROM communities WHERE slug = 'admin-fantasma'`);
  assert.equal(leftover.rowCount, 0);
  assert.equal(await findCommunityByHost(pool, 'admin-fantasma.goblins.test'), null);
});

test('createCommunity: dos creaciones simultáneas del mismo slug dejan una sola', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  const results = await Promise.all([
    createCommunity(pool, { slug: 'carrera', name: 'A', host: 'carrera.goblins.test' }),
    createCommunity(pool, { slug: 'carrera', name: 'B', host: 'carrera.goblins.test' }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  const rows = await pool.query(`SELECT count(*)::int AS n FROM communities WHERE slug = 'carrera'`);
  assert.equal(rows.rows[0].n, 1);
});

test('listCommunities devuelve host principal y número de miembros', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  const adminId = await newUser('admin-lista@example.com');
  await createCommunity(pool, { slug: 'listada', name: 'Listada', host: 'listada.goblins.test', adminUserId: adminId });
  const all = await listCommunities(pool);
  const item = all.find((c) => c.slug === 'listada');
  assert.ok(item);
  assert.equal(item.primaryHost, 'listada.goblins.test');
  assert.equal(item.memberCount, 1);
  assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('setCommunityStatus suspende, reactiva y devuelve null si no existe', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  const created = await createCommunity(pool, { slug: 'estado', name: 'Estado', host: 'estado.goblins.test' });
  assert.ok(created.ok);
  const suspended = await setCommunityStatus(pool, created.community.id, 'suspended');
  assert.equal(suspended?.status, 'suspended');
  assert.equal((await findCommunityByHost(pool, 'estado.goblins.test'))?.status, 'suspended');
  const active = await setCommunityStatus(pool, created.community.id, 'active');
  assert.equal(active?.status, 'active');
  assert.equal(await setCommunityStatus(pool, '00000000-0000-0000-0000-000000000000', 'suspended'), null);
});
