import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { loadRootEnv } from '@goblins/core';
import {
  createCommunity,
  findCommunityByHost,
  listCommunities,
  setCommunityStatus,
} from './communities';
import { listUsers, setCanCreateCommunities } from './users';
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

test('listCommunities con adminUserId devuelve solo las que administra esa cuenta', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  const ana = await newUser('ana-filtro@example.com');
  const beto = await newUser('beto-filtro@example.com');
  await createCommunity(pool, { slug: 'de-ana-1', name: 'A1', host: 'de-ana-1.goblins.test', adminUserId: ana });
  await createCommunity(pool, { slug: 'de-ana-2', name: 'A2', host: 'de-ana-2.goblins.test', adminUserId: ana });
  await createCommunity(pool, { slug: 'de-beto', name: 'B', host: 'de-beto.goblins.test', adminUserId: beto });
  // Ana es solo miembro (no admin) de la de Beto: no debe aparecer entre las suyas.
  const betoCommunity = await pool.query(`SELECT id FROM communities WHERE slug = 'de-beto'`);
  await pool.query(`INSERT INTO memberships (community_id, user_id, role) VALUES ($1, $2, 'member')`, [
    betoCommunity.rows[0].id,
    ana,
  ]);

  const mine = await listCommunities(pool, { adminUserId: ana });
  assert.deepEqual(mine.map((c) => c.slug).sort(), ['de-ana-1', 'de-ana-2']);

  const nobody = await newUser('sin-foros@example.com');
  assert.deepEqual(await listCommunities(pool, { adminUserId: nobody }), []);

  const all = await listCommunities(pool);
  assert.ok(all.some((c) => c.slug === 'de-beto') && all.some((c) => c.slug === 'de-ana-1'));
});

test('el permiso de crear comunidades empieza desactivado y se puede activar y desactivar', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  const id = await newUser('permiso@example.com');
  const find = async () => (await listUsers(pool)).find((u) => u.id === id);

  assert.equal((await find())?.canCreateCommunities, false);
  assert.equal(await setCanCreateCommunities(pool, id, true), true);
  assert.equal((await find())?.canCreateCommunities, true);
  assert.equal(await setCanCreateCommunities(pool, id, false), true);
  assert.equal((await find())?.canCreateCommunities, false);
  assert.equal(await setCanCreateCommunities(pool, '00000000-0000-0000-0000-000000000000', true), false);
});

test('listUsers cuenta las comunidades que administra cada cuenta y no expone el hash', async (t) => {
  if (skipIfNoDb(t)) return;
  const pool = temp!.pool;
  const id = await newUser('cuenta-lista@example.com');
  await createCommunity(pool, { slug: 'cuenta-1', name: 'C1', host: 'cuenta-1.goblins.test', adminUserId: id });
  await createCommunity(pool, { slug: 'cuenta-2', name: 'C2', host: 'cuenta-2.goblins.test', adminUserId: id });
  const user = (await listUsers(pool)).find((u) => u.id === id);
  assert.equal(user?.adminOf, 2);
  assert.equal(user?.email, 'cuenta-lista@example.com');
  assert.ok(!('passwordHash' in (user as object)));
  assert.match(user!.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});
