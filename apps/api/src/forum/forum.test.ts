import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { loadRootEnv } from '@goblins/core';
import { addMembership, createCommunity, createTempDatabase, type TempDatabase } from '@goblins/database';
import type { AuthContext, AuthRequest } from '../auth/auth';
import type { Tenant } from '../tenant/tenant';
import { ForumController } from './forum.controller';
import { ForumService } from './forum.service';
import {
  createCategorySchema,
  createForumSchema,
  createPostSchema,
  createTopicSchema,
  pageSchema,
  updateCategorySchema,
  updateForumSchema,
} from './schemas';

loadRootEnv();

// ---------- Esquemas (no necesitan base de datos) ----------

test('esquemas: recortan espacios y rechazan lo vacío o demasiado largo', () => {
  assert.equal(createCategorySchema.parse({ name: '  General ' }).name, 'General');
  assert.equal(createCategorySchema.safeParse({ name: '   ' }).success, false);
  assert.equal(createCategorySchema.safeParse({ name: 'x'.repeat(101) }).success, false);
  assert.equal(createTopicSchema.safeParse({ title: 'x'.repeat(201), body: 'ok' }).success, false);
  assert.equal(createTopicSchema.safeParse({ title: 'ok', body: '   ' }).success, false);
  assert.equal(createPostSchema.safeParse({ body: 'x'.repeat(50_001) }).success, false);
  assert.equal(createPostSchema.safeParse({ body: 'x'.repeat(50_000) }).success, true);
});

test('esquemas: los cambios deben traer al menos un campo y los ids deben ser uuid', () => {
  assert.equal(updateCategorySchema.safeParse({}).success, false);
  assert.equal(updateForumSchema.safeParse({}).success, false);
  assert.equal(updateForumSchema.safeParse({ isLocked: false }).success, true);
  assert.equal(updateForumSchema.safeParse({ isLocked: 'si' }).success, false);
  assert.equal(createForumSchema.safeParse({ categoryId: 'no-es-uuid', name: 'x' }).success, false);
  assert.equal(createForumSchema.safeParse({ categoryId: randomUUID(), name: 'x', position: 1.5 }).success, false);
});

test('esquemas: los campos desconocidos se descartan (communityId y authorId no pasan)', () => {
  const parsed = createTopicSchema.parse({ title: 'T', body: 'B', communityId: randomUUID(), authorId: randomUUID() });
  assert.deepEqual(Object.keys(parsed).sort(), ['body', 'title']);
});

test('esquema de paginación: convierte texto en número y acota', () => {
  assert.deepEqual(pageSchema.parse({ limit: '20', offset: '40' }), { limit: 20, offset: 40 });
  assert.deepEqual(pageSchema.parse({}), {});
  for (const bad of [{ limit: '0' }, { limit: '101' }, { limit: 'abc' }, { offset: '-1' }, { limit: '1.5' }]) {
    assert.equal(pageSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

// ---------- Controlador: quién puede qué (con servicio simulado) ----------

const COMMUNITY_ID = randomUUID();
const ID = randomUUID();
const community: Tenant = { kind: 'community', community: { id: COMMUNITY_ID, slug: 'foro', name: 'Foro', status: 'active' } };
const platform: Tenant = { kind: 'platform' };
const auth = (role: AuthContext['role']): AuthContext => ({
  userId: `user-${role}`,
  email: `${role}@example.com`,
  displayName: role,
  role,
  canCreateCommunities: false,
  csrfToken: 'x',
});
const requestOf = (tenant: Tenant | undefined, a?: AuthContext) => ({ tenant, auth: a }) as unknown as AuthRequest;

function recorder() {
  const calls: { method: string; args: unknown[] }[] = [];
  const service = new Proxy(
    {},
    {
      get: (_target, method: string) => async (...args: unknown[]) => {
        calls.push({ method, args });
        return [];
      },
    },
  ) as unknown as ForumService;
  return { controller: new ForumController(service), calls };
}

type Operation = [name: string, needs: 'member' | 'admin', run: (c: ForumController, r: AuthRequest) => Promise<unknown>];
const operations: Operation[] = [
  ['listCategories', 'member', (c, r) => c.listCategories(r)],
  ['createCategory', 'admin', (c, r) => c.createCategory(r, { name: 'Cat' })],
  ['updateCategory', 'admin', (c, r) => c.updateCategory(r, ID, { name: 'Nueva' })],
  ['deleteCategory', 'admin', (c, r) => c.deleteCategory(r, ID)],
  ['listForums', 'member', (c, r) => c.listForums(r)],
  ['createForum', 'admin', (c, r) => c.createForum(r, { categoryId: ID, name: 'Foro' })],
  ['updateForum', 'admin', (c, r) => c.updateForum(r, ID, { isLocked: true })],
  ['deleteForum', 'admin', (c, r) => c.deleteForum(r, ID)],
  ['listTopics', 'member', (c, r) => c.listTopics(r, ID, {})],
  ['createTopic', 'member', (c, r) => c.createTopic(r, ID, { title: 'T', body: 'B' })],
  ['getTopic', 'member', (c, r) => c.getTopic(r, ID)],
  ['listPosts', 'member', (c, r) => c.listPosts(r, ID, {})],
  ['createPost', 'member', (c, r) => c.createPost(r, ID, { body: 'B' })],
];

test('controlador: fuera de una comunidad no se puede nada, ni siendo owner', async () => {
  for (const [name, , run] of operations) {
    const { controller, calls } = recorder();
    for (const req of [requestOf(platform, auth('owner')), requestOf(undefined, auth('admin')), requestOf(platform)]) {
      await assert.rejects(run(controller, req), (e) => e instanceof ForbiddenException, name);
    }
    assert.equal(calls.length, 0, `${name} no debe llegar al servicio`);
  }
});

test('controlador: no hay invitados (sin sesión es 401) ni sirven roles del panel central', async () => {
  for (const [name, , run] of operations) {
    const { controller, calls } = recorder();
    await assert.rejects(run(controller, requestOf(community)), (e) => e instanceof UnauthorizedException, name);
    for (const role of ['owner', 'user'] as const) {
      await assert.rejects(run(controller, requestOf(community, auth(role))), (e) => e instanceof ForbiddenException, name);
    }
    assert.equal(calls.length, 0, name);
  }
});

test('controlador: un miembro lee, crea temas y responde; no gestiona la estructura', async () => {
  for (const [name, needs, run] of operations) {
    const { controller, calls } = recorder();
    const req = requestOf(community, auth('member'));
    if (needs === 'member') {
      await run(controller, req);
      assert.equal(calls.length, 1, `${name} debe llegar al servicio`);
    } else {
      await assert.rejects(run(controller, req), (e) => e instanceof ForbiddenException, name);
      assert.equal(calls.length, 0, `${name} no debe llegar al servicio`);
    }
  }
});

test('controlador: un administrador puede todo dentro de su comunidad', async () => {
  for (const [name, , run] of operations) {
    const { controller, calls } = recorder();
    await run(controller, requestOf(community, auth('admin')));
    assert.equal(calls.length, 1, name);
    assert.equal(calls[0]!.args[0], COMMUNITY_ID, `${name}: la comunidad sale del host`);
  }
});

test('controlador: la comunidad y el autor nunca salen del cuerpo', async () => {
  const { controller, calls } = recorder();
  const req = requestOf(community, auth('member'));
  const otherCommunity = randomUUID();
  await controller.createTopic(req, ID, { title: 'T', body: 'B', communityId: otherCommunity, authorId: 'otro' });
  await controller.createPost(req, ID, { body: 'B', communityId: otherCommunity, authorId: 'otro' });
  assert.deepEqual(calls[0]!.args, [COMMUNITY_ID, ID, 'user-member', { title: 'T', body: 'B' }]);
  assert.deepEqual(calls[1]!.args, [COMMUNITY_ID, ID, 'user-member', { body: 'B' }]);
});

test('controlador: los permisos se comprueban antes que los datos', async () => {
  const { controller, calls } = recorder();
  // Un miembro que envía basura a una ruta de administrador recibe 403, no un 400 con detalles.
  await assert.rejects(
    controller.createForum(requestOf(community, auth('member')), { name: 123 }),
    (e) => e instanceof ForbiddenException,
  );
  // Un administrador con datos inválidos recibe 400 y no se llama al servicio.
  const admin = requestOf(community, auth('admin'));
  await assert.rejects(controller.createForum(admin, { name: 123 }), (e) => e instanceof BadRequestException);
  await assert.rejects(controller.updateForum(admin, ID, {}), (e) => e instanceof BadRequestException);
  await assert.rejects(controller.deleteForum(admin, 'no-es-uuid'), (e) => e instanceof BadRequestException);
  assert.equal(calls.length, 0);
});

test('controlador: ids y paginación inválidos dan 400, y la paginación llega como números', async () => {
  const { controller, calls } = recorder();
  const member = requestOf(community, auth('member'));
  await assert.rejects(controller.getTopic(member, 'x'), (e) => e instanceof BadRequestException);
  await assert.rejects(controller.listTopics(member, ID, { limit: '500' }), (e) => e instanceof BadRequestException);
  assert.equal(calls.length, 0);
  await controller.listPosts(member, ID, { limit: '10', offset: '20' });
  assert.deepEqual(calls[0]!.args, [COMMUNITY_ID, ID, { limit: 10, offset: 20 }]);
});

// ---------- Servicio y controlador con PostgreSQL real ----------

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

interface Site {
  communityId: string;
  adminId: string;
  memberId: string;
  service: ForumService;
  controller: ForumController;
  as: (role: 'admin' | 'member') => AuthRequest;
}

/** Comunidad real con un administrador y un miembro. */
async function site(): Promise<Site> {
  const n = ++counter;
  const user = async (label: string): Promise<string> => {
    const r = await temp!.pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
      [`${label}${n}@example.com`, `${label} ${n}`],
    );
    return r.rows[0]!.id;
  };
  const adminId = await user('admin');
  const memberId = await user('miembro');
  const created = await createCommunity(temp!.pool, { slug: `foro-${n}`, name: `Foro ${n}`, host: `foro-${n}.test` });
  assert.ok(created.ok);
  await addMembership(temp!.pool, created.community.id, adminId, 'admin');
  await addMembership(temp!.pool, created.community.id, memberId, 'member');
  const service = new ForumService(temp!.pool);
  const tenant: Tenant = { kind: 'community', community: created.community };
  const contexts = {
    admin: { ...auth('admin'), userId: adminId },
    member: { ...auth('member'), userId: memberId },
  };
  return {
    communityId: created.community.id,
    adminId,
    memberId,
    service,
    controller: new ForumController(service),
    as: (role) => requestOf(tenant, contexts[role]),
  };
}

test('flujo completo: el administrador monta el foro y los miembros participan', async (t) => {
  if (skipIfNoDb(t)) return;
  const s = await site();

  const { category } = (await s.controller.createCategory(s.as('admin'), { name: 'General' })) as {
    category: { id: string };
  };
  const { forum } = (await s.controller.createForum(s.as('admin'), { categoryId: category.id, name: 'Charla' })) as {
    forum: { id: string };
  };
  const created = await s.controller.createTopic(s.as('member'), forum.id, { title: 'Hola', body: 'Primer mensaje' });
  assert.equal(created.topic.authorId, s.memberId);
  assert.equal(created.topic.authorName, `miembro ${counter}`);

  const { post } = await s.controller.createPost(s.as('admin'), created.topic.id, { body: 'Bienvenida' });
  assert.equal(post.authorId, s.adminId);

  const { topic } = await s.controller.getTopic(s.as('member'), created.topic.id);
  assert.equal(topic.replyCount, 1);
  const { posts } = await s.controller.listPosts(s.as('member'), created.topic.id, { limit: '10' });
  assert.deepEqual(
    posts.map((p) => p.body),
    ['Primer mensaje', 'Bienvenida'],
  );
  const { topics } = await s.controller.listTopics(s.as('member'), forum.id, {});
  assert.equal(topics.length, 1);
  assert.equal((await s.controller.listForums(s.as('member'))).forums[0]?.topicCount, 1);
});

test('aislamiento de punta a punta: lo de una comunidad no existe para la otra', async (t) => {
  if (skipIfNoDb(t)) return;
  const a = await site();
  const b = await site();
  const { category } = (await b.controller.createCategory(b.as('admin'), { name: 'Privada' })) as {
    category: { id: string };
  };
  const { forum } = (await b.controller.createForum(b.as('admin'), { categoryId: category.id, name: 'Secreto' })) as {
    forum: { id: string };
  };
  const { topic } = await b.controller.createTopic(b.as('member'), forum.id, { title: 'Solo B', body: 'texto' });

  // Desde A, con ids de B: todo da 404 y las listas no muestran nada de B.
  assert.deepEqual((await a.controller.listCategories(a.as('admin'))).categories, []);
  assert.deepEqual((await a.controller.listForums(a.as('admin'))).forums, []);
  const notFound = (e: unknown) => e instanceof NotFoundException;
  await assert.rejects(a.controller.getTopic(a.as('admin'), topic.id), notFound);
  await assert.rejects(a.controller.listPosts(a.as('admin'), topic.id, {}), notFound);
  await assert.rejects(a.controller.listTopics(a.as('admin'), forum.id, {}), notFound);
  await assert.rejects(a.controller.createTopic(a.as('member'), forum.id, { title: 'x', body: 'x' }), notFound);
  await assert.rejects(a.controller.createPost(a.as('member'), topic.id, { body: 'x' }), notFound);
  await assert.rejects(a.controller.updateForum(a.as('admin'), forum.id, { name: 'hackeado' }), notFound);
  await assert.rejects(a.controller.deleteCategory(a.as('admin'), category.id), notFound);
  await assert.rejects(a.controller.createForum(a.as('admin'), { categoryId: category.id, name: 'x' }), notFound);
  assert.equal((await b.controller.listForums(b.as('member'))).forums[0]?.name, 'Secreto');
});

test('servicio: borrar con contenido da 409, y los bloqueos dan 403', async (t) => {
  if (skipIfNoDb(t)) return;
  const s = await site();
  const { category } = (await s.controller.createCategory(s.as('admin'), { name: 'General' })) as {
    category: { id: string };
  };
  const { forum } = (await s.controller.createForum(s.as('admin'), { categoryId: category.id, name: 'Foro' })) as {
    forum: { id: string };
  };
  await assert.rejects(s.controller.deleteCategory(s.as('admin'), category.id), (e) => e instanceof ConflictException);

  const { topic } = await s.controller.createTopic(s.as('member'), forum.id, { title: 'T', body: 'B' });
  await assert.rejects(s.controller.deleteForum(s.as('admin'), forum.id), (e) => e instanceof ConflictException);

  await s.controller.updateForum(s.as('admin'), forum.id, { isLocked: true });
  const forbidden = (e: unknown) => e instanceof ForbiddenException;
  await assert.rejects(s.controller.createTopic(s.as('member'), forum.id, { title: 'x', body: 'x' }), forbidden);
  await assert.rejects(s.controller.createPost(s.as('member'), topic.id, { body: 'x' }), forbidden);
  await s.controller.updateForum(s.as('admin'), forum.id, { isLocked: false });
  await s.controller.createPost(s.as('member'), topic.id, { body: 'ya se puede' });

  await temp!.pool.query(`UPDATE topics SET is_locked = true WHERE id = $1`, [topic.id]);
  await assert.rejects(s.controller.createPost(s.as('member'), topic.id, { body: 'x' }), forbidden);
});

test('servicio: quien no es miembro de la comunidad no puede escribir aunque llegue a la función', async (t) => {
  if (skipIfNoDb(t)) return;
  const a = await site();
  const b = await site();
  const { category } = (await a.controller.createCategory(a.as('admin'), { name: 'General' })) as {
    category: { id: string };
  };
  const { forum } = (await a.controller.createForum(a.as('admin'), { categoryId: category.id, name: 'Foro' })) as {
    forum: { id: string };
  };
  // Se salta el controlador a propósito: un miembro de B como autor en A lo para la base de datos.
  await assert.rejects(
    a.service.createTopic(a.communityId, forum.id, b.memberId, { title: 'x', body: 'x' }),
    (e) => e instanceof ForbiddenException,
  );
  assert.deepEqual((await a.controller.listTopics(a.as('admin'), forum.id, {})).topics, []);
});
