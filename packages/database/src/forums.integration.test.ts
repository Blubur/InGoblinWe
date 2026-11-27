import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { loadRootEnv } from '@goblins/core';
import { createCommunity } from './communities';
import {
  createCategory,
  createForum,
  deleteCategory,
  deleteForum,
  findForum,
  listCategories,
  listForums,
  updateCategory,
  updateForum,
  type Forum,
} from './forums';
import { addMembership } from './memberships';
import { createPost, createTopic, findTopic, listPosts, listTopics } from './topics';
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

let counter = 0;

/** Comunidad nueva con un usuario miembro. */
async function world(): Promise<{
  communityId: string;
  userId: string;
  userName: string;
  categoryId: string;
  forum: Forum;
}> {
  const n = ++counter;
  const userName = `Persona ${n}`;
  const user = await temp!.pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
    [`persona${n}@example.com`, userName],
  );
  const userId = user.rows[0]!.id;
  const created = await createCommunity(temp!.pool, { slug: `foro-${n}`, name: `Foro ${n}`, host: `foro-${n}.test` });
  assert.ok(created.ok);
  const communityId = created.community.id;
  await addMembership(temp!.pool, communityId, userId, 'member');
  const category = await createCategory(temp!.pool, communityId, { name: 'General' });
  const forum = await createForum(temp!.pool, communityId, { categoryId: category.id, name: 'Charla' });
  assert.ok(forum.ok);
  return { communityId, userId, userName, categoryId: category.id, forum: forum.forum };
}

async function sqlCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

test('categorías y foros: se listan en orden, con subforos y número de temas', async (t) => {
  if (skipIfNoDb(t)) return;
  const w = await world();
  const second = await createCategory(temp!.pool, w.communityId, { name: 'Off-topic', position: 5 });
  const first = await createCategory(temp!.pool, w.communityId, { name: 'Anuncios', position: -1 });
  assert.deepEqual(
    (await listCategories(temp!.pool, w.communityId)).map((c) => c.name),
    ['Anuncios', 'General', 'Off-topic'],
  );

  const sub = await createForum(temp!.pool, w.communityId, {
    categoryId: w.categoryId,
    parentForumId: w.forum.id,
    name: 'Subforo',
    description: 'Dentro de Charla',
  });
  assert.ok(sub.ok);
  assert.equal(sub.forum.parentForumId, w.forum.id);
  assert.equal(sub.forum.topicCount, 0);

  await createForum(temp!.pool, w.communityId, { categoryId: second.id, name: 'Cine' });
  await createForum(temp!.pool, w.communityId, { categoryId: first.id, name: 'Novedades' });
  const names = (await listForums(temp!.pool, w.communityId)).map((f) => f.name);
  assert.deepEqual(names, ['Novedades', 'Charla', 'Subforo', 'Cine']);

  const topic = await createTopic(temp!.pool, w.communityId, {
    forumId: w.forum.id,
    authorId: w.userId,
    title: 'Hola',
    body: 'Primer mensaje',
  });
  assert.ok(topic.ok);
  assert.equal((await findForum(temp!.pool, w.communityId, w.forum.id))?.topicCount, 1);
});

test('aislamiento: no se puede mezclar categorías, foros ni temas de comunidades distintas', async (t) => {
  if (skipIfNoDb(t)) return;
  const a = await world();
  const b = await world();

  const foreignCategory = await createForum(temp!.pool, a.communityId, { categoryId: b.categoryId, name: 'x' });
  assert.deepEqual(foreignCategory, { ok: false, reason: 'invalid_reference' });

  const foreignParent = await createForum(temp!.pool, a.communityId, {
    categoryId: a.categoryId,
    parentForumId: b.forum.id,
    name: 'x',
  });
  assert.deepEqual(foreignParent, { ok: false, reason: 'invalid_reference' });

  // Un subforo debe estar en la misma categoría que su padre.
  const other = await createCategory(temp!.pool, a.communityId, { name: 'Otra' });
  const crossCategory = await createForum(temp!.pool, a.communityId, {
    categoryId: other.id,
    parentForumId: a.forum.id,
    name: 'x',
  });
  assert.deepEqual(crossCategory, { ok: false, reason: 'invalid_reference' });

  // Ids de otra comunidad: nada se encuentra ni se modifica.
  assert.equal(await findForum(temp!.pool, a.communityId, b.forum.id), null);
  assert.equal(await updateForum(temp!.pool, a.communityId, b.forum.id, { name: 'hackeado' }), null);
  assert.equal(await updateCategory(temp!.pool, a.communityId, b.categoryId, { name: 'hackeado' }), null);
  assert.equal(await deleteForum(temp!.pool, a.communityId, b.forum.id), 'not_found');
  assert.equal(await deleteCategory(temp!.pool, a.communityId, b.categoryId), 'not_found');
  assert.equal((await findForum(temp!.pool, b.communityId, b.forum.id))?.name, 'Charla');

  const created = await createTopic(temp!.pool, b.communityId, {
    forumId: b.forum.id,
    authorId: b.userId,
    title: 'Privado de B',
    body: 'texto',
  });
  assert.ok(created.ok);
  assert.equal(await findTopic(temp!.pool, a.communityId, created.topic.id), null);
  assert.deepEqual(await listPosts(temp!.pool, a.communityId, created.topic.id), []);
  assert.deepEqual(await listTopics(temp!.pool, a.communityId, b.forum.id), []);
  assert.deepEqual(
    await createTopic(temp!.pool, a.communityId, { forumId: b.forum.id, authorId: a.userId, title: 'x', body: 'x' }),
    { ok: false, reason: 'forum_not_found' },
  );
  assert.deepEqual(await createPost(temp!.pool, a.communityId, { topicId: created.topic.id, authorId: a.userId, body: 'x' }), {
    ok: false,
    reason: 'topic_not_found',
  });
});

test('un foro no puede colgar de sí mismo ni de uno de sus descendientes', async (t) => {
  if (skipIfNoDb(t)) return;
  const w = await world();
  const child = await createForum(temp!.pool, w.communityId, {
    categoryId: w.categoryId,
    parentForumId: w.forum.id,
    name: 'Hijo',
  });
  assert.ok(child.ok);
  const grandchild = await createForum(temp!.pool, w.communityId, {
    categoryId: w.categoryId,
    parentForumId: child.forum.id,
    name: 'Nieto',
  });
  assert.ok(grandchild.ok);

  const CHECK = '23514';
  assert.equal(
    await sqlCode(temp!.pool.query(`UPDATE forums SET parent_forum_id = id WHERE id = $1`, [w.forum.id])),
    CHECK,
  );
  assert.equal(
    await sqlCode(
      temp!.pool.query(`UPDATE forums SET parent_forum_id = $2 WHERE id = $1`, [w.forum.id, grandchild.forum.id]),
    ),
    CHECK,
  );
});

test('borrado: no se vacía por sorpresa una categoría o un foro con contenido', async (t) => {
  if (skipIfNoDb(t)) return;
  const w = await world();
  const sub = await createForum(temp!.pool, w.communityId, {
    categoryId: w.categoryId,
    parentForumId: w.forum.id,
    name: 'Sub',
  });
  assert.ok(sub.ok);

  assert.equal(await deleteCategory(temp!.pool, w.communityId, w.categoryId), 'not_empty');
  assert.equal(await deleteForum(temp!.pool, w.communityId, w.forum.id), 'not_empty'); // tiene subforo

  const topic = await createTopic(temp!.pool, w.communityId, {
    forumId: sub.forum.id,
    authorId: w.userId,
    title: 'Tema',
    body: 'texto',
  });
  assert.ok(topic.ok);
  assert.equal(await deleteForum(temp!.pool, w.communityId, sub.forum.id), 'not_empty'); // tiene temas

  await temp!.pool.query(`DELETE FROM topics WHERE id = $1`, [topic.topic.id]);
  assert.equal(await deleteForum(temp!.pool, w.communityId, sub.forum.id), 'deleted');
  assert.equal(await deleteForum(temp!.pool, w.communityId, w.forum.id), 'deleted');
  assert.equal(await deleteCategory(temp!.pool, w.communityId, w.categoryId), 'deleted');
});

test('temas: solo crean los miembros de esa comunidad y no en foros bloqueados', async (t) => {
  if (skipIfNoDb(t)) return;
  const a = await world();
  const b = await world();

  // Un miembro de B no puede escribir en A.
  assert.deepEqual(
    await createTopic(temp!.pool, a.communityId, { forumId: a.forum.id, authorId: b.userId, title: 'x', body: 'x' }),
    { ok: false, reason: 'not_a_member' },
  );
  assert.equal((await listTopics(temp!.pool, a.communityId, a.forum.id)).length, 0);

  const ok = await createTopic(temp!.pool, a.communityId, {
    forumId: a.forum.id,
    authorId: a.userId,
    title: 'Bienvenida',
    body: 'Hola a todos',
  });
  assert.ok(ok.ok);
  assert.equal(ok.topic.authorName, a.userName);
  assert.equal(ok.topic.replyCount, 0);
  assert.equal(ok.post.body, 'Hola a todos');

  await updateForum(temp!.pool, a.communityId, a.forum.id, { isLocked: true });
  assert.deepEqual(
    await createTopic(temp!.pool, a.communityId, { forumId: a.forum.id, authorId: a.userId, title: 'y', body: 'y' }),
    { ok: false, reason: 'forum_locked' },
  );
});

test('respuestas: cuentan, actualizan la actividad y respetan los bloqueos', async (t) => {
  if (skipIfNoDb(t)) return;
  const w = await world();
  const created = await createTopic(temp!.pool, w.communityId, {
    forumId: w.forum.id,
    authorId: w.userId,
    title: 'Hilo',
    body: 'uno',
  });
  assert.ok(created.ok);
  const previous = created.topic.lastPostAt;

  const reply = await createPost(temp!.pool, w.communityId, { topicId: created.topic.id, authorId: w.userId, body: 'dos' });
  assert.ok(reply.ok);
  const updated = await findTopic(temp!.pool, w.communityId, created.topic.id);
  assert.equal(updated?.replyCount, 1);
  assert.ok(updated!.lastPostAt >= previous);

  const posts = await listPosts(temp!.pool, w.communityId, created.topic.id);
  assert.deepEqual(
    posts.map((p) => p.body),
    ['uno', 'dos'],
  );

  await temp!.pool.query(`UPDATE topics SET is_locked = true WHERE id = $1`, [created.topic.id]);
  assert.deepEqual(
    await createPost(temp!.pool, w.communityId, { topicId: created.topic.id, authorId: w.userId, body: 'tres' }),
    { ok: false, reason: 'topic_locked' },
  );
  await temp!.pool.query(`UPDATE topics SET is_locked = false WHERE id = $1`, [created.topic.id]);
  await updateForum(temp!.pool, w.communityId, w.forum.id, { isLocked: true });
  assert.deepEqual(
    await createPost(temp!.pool, w.communityId, { topicId: created.topic.id, authorId: w.userId, body: 'tres' }),
    { ok: false, reason: 'forum_locked' },
  );
});

test('respuestas simultáneas: el contador no pierde ninguna', async (t) => {
  if (skipIfNoDb(t)) return;
  const w = await world();
  const created = await createTopic(temp!.pool, w.communityId, {
    forumId: w.forum.id,
    authorId: w.userId,
    title: 'Concurrencia',
    body: 'inicio',
  });
  assert.ok(created.ok);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      createPost(temp!.pool, w.communityId, { topicId: created.topic.id, authorId: w.userId, body: `r${i}` }),
    ),
  );
  assert.ok(results.every((r) => r.ok));
  assert.equal((await findTopic(temp!.pool, w.communityId, created.topic.id))?.replyCount, 8);
  assert.equal((await listPosts(temp!.pool, w.communityId, created.topic.id, { limit: 100 })).length, 9);
});

test('listado de temas: fijados primero, luego por actividad; la paginación tiene tope', async (t) => {
  if (skipIfNoDb(t)) return;
  const w = await world();
  const ids: Record<string, string> = {};
  for (const title of ['viejo', 'reciente', 'fijado']) {
    const r = await createTopic(temp!.pool, w.communityId, {
      forumId: w.forum.id,
      authorId: w.userId,
      title,
      body: title,
    });
    assert.ok(r.ok);
    ids[title] = r.topic.id;
  }
  await temp!.pool.query(`UPDATE topics SET last_post_at = now() - interval '2 days' WHERE id = $1`, [ids.viejo]);
  await temp!.pool.query(`UPDATE topics SET last_post_at = now() - interval '1 days' WHERE id = $1`, [ids.reciente]);
  await temp!.pool.query(`UPDATE topics SET is_pinned = true, last_post_at = now() - interval '9 days' WHERE id = $1`, [
    ids.fijado,
  ]);

  assert.deepEqual(
    (await listTopics(temp!.pool, w.communityId, w.forum.id)).map((x) => x.title),
    ['fijado', 'reciente', 'viejo'],
  );
  assert.deepEqual(
    (await listTopics(temp!.pool, w.communityId, w.forum.id, { limit: 1, offset: 1 })).map((x) => x.title),
    ['reciente'],
  );
  // Un límite absurdo se recorta y uno negativo se corrige: no hay error ni listados enormes.
  assert.equal((await listTopics(temp!.pool, w.communityId, w.forum.id, { limit: 1_000_000 })).length, 3);
  assert.equal((await listTopics(temp!.pool, w.communityId, w.forum.id, { limit: -5, offset: -5 })).length, 1);
});

test('si alguien deja la comunidad, sus mensajes se conservan sin autor; borrar la comunidad lo arrastra todo', async (t) => {
  if (skipIfNoDb(t)) return;
  const w = await world();
  const created = await createTopic(temp!.pool, w.communityId, {
    forumId: w.forum.id,
    authorId: w.userId,
    title: 'Se queda',
    body: 'mensaje',
  });
  assert.ok(created.ok);

  await temp!.pool.query(`DELETE FROM memberships WHERE community_id = $1 AND user_id = $2`, [w.communityId, w.userId]);
  const topic = await findTopic(temp!.pool, w.communityId, created.topic.id);
  assert.equal(topic?.authorId, null);
  assert.equal(topic?.authorName, null);
  const posts = await listPosts(temp!.pool, w.communityId, created.topic.id);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.authorId, null);

  await temp!.pool.query(`DELETE FROM communities WHERE id = $1`, [w.communityId]);
  for (const table of ['categories', 'forums', 'topics', 'posts']) {
    const left = await temp!.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE community_id = $1`, [
      w.communityId,
    ]);
    assert.equal(left.rows[0].n, 0, `${table} debería quedar vacía`);
  }
});
