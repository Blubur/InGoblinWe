import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { loadRootEnv } from '@goblins/core';
import { createTempDatabase, type Pool, type TempDatabase } from '@goblins/database';
import type { AuthContext, AuthRequest } from '../auth/auth';
import type { Tenant } from '../tenant/tenant';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';
import { createCommunitySchema, RESERVED_SLUGS, setStatusSchema } from './schemas';

loadRootEnv();

// ---------- Esquemas (no necesitan base de datos) ----------

test('esquema: normaliza el slug y acepta un alta mínima', () => {
  const parsed = createCommunitySchema.parse({ slug: '  Mi-Foro  ', name: '  Mi foro ' });
  assert.equal(parsed.slug, 'mi-foro');
  assert.equal(parsed.name, 'Mi foro');
  assert.equal(parsed.adminEmail, undefined);
});

test('esquema: rechaza slugs inválidos', () => {
  for (const slug of ['ab', '-foro', 'foro-', 'fo ro', 'foro.com', 'fóro', 'a'.repeat(64), '../x', 'foro_1']) {
    assert.equal(createCommunitySchema.safeParse({ slug, name: 'X' }).success, false, `debería rechazar "${slug}"`);
  }
});

test('esquema: rechaza slugs reservados', () => {
  for (const slug of RESERVED_SLUGS) {
    if (slug.length < 3) continue; // los de menos de 3 caracteres ya caen por longitud
    assert.equal(createCommunitySchema.safeParse({ slug, name: 'X' }).success, false, `debería reservar "${slug}"`);
  }
});

test('esquema: nombre obligatorio y email del administrador válido', () => {
  assert.equal(createCommunitySchema.safeParse({ slug: 'foro', name: '   ' }).success, false);
  assert.equal(createCommunitySchema.safeParse({ slug: 'foro', name: 'X', adminEmail: 'no-es-email' }).success, false);
  const ok = createCommunitySchema.parse({ slug: 'foro', name: 'X', adminEmail: ' ADMIN@Example.com ' });
  assert.equal(ok.adminEmail, 'admin@example.com');
});

test('esquema de estado: solo active o suspended', () => {
  assert.equal(setStatusSchema.safeParse({ status: 'active' }).success, true);
  assert.equal(setStatusSchema.safeParse({ status: 'suspended' }).success, true);
  assert.equal(setStatusSchema.safeParse({ status: 'deleted' }).success, false);
  assert.equal(setStatusSchema.safeParse({}).success, false);
});

// ---------- Controlador: quién puede entrar (con servicio simulado) ----------

const unusedService = {
  create: async () => {
    throw new Error('no debería llamarse');
  },
  list: async () => {
    throw new Error('no debería llamarse');
  },
  setStatus: async () => {
    throw new Error('no debería llamarse');
  },
} as unknown as CommunitiesService;

const ownerAuth: AuthContext = { userId: 'u1', email: 'dueno@example.com', displayName: 'Dueño', role: 'owner', csrfToken: 'x' };
const platform: Tenant = { kind: 'platform' };
const inCommunity: Tenant = { kind: 'community', community: { id: 'c1', slug: 'foro', name: 'Foro', status: 'active' } };
const requestOf = (tenant: Tenant | undefined, auth?: AuthContext) => ({ tenant, auth }) as unknown as AuthRequest;

test('controlador: sin sesión es 401 y con rol que no es owner es 403', async () => {
  const controller = new CommunitiesController(unusedService);
  await assert.rejects(controller.list(requestOf(platform)), (e) => e instanceof UnauthorizedException);
  await assert.rejects(
    controller.list(requestOf(platform, { ...ownerAuth, role: 'admin' })),
    (e) => e instanceof ForbiddenException,
  );
  await assert.rejects(
    controller.create(requestOf(platform, { ...ownerAuth, role: 'member' }), { slug: 'foro', name: 'X' }),
    (e) => e instanceof ForbiddenException,
  );
});

test('controlador: desde el host de una comunidad nunca se puede, ni siquiera siendo owner', async () => {
  const controller = new CommunitiesController(unusedService);
  const req = requestOf(inCommunity, ownerAuth);
  await assert.rejects(controller.list(req), (e) => e instanceof ForbiddenException);
  await assert.rejects(controller.create(req, { slug: 'foro', name: 'X' }), (e) => e instanceof ForbiddenException);
  await assert.rejects(
    controller.setStatus(req, '3f8f2f0e-6f43-4b7e-8d3a-0a5c9a1b2c3d', { status: 'suspended' }),
    (e) => e instanceof ForbiddenException,
  );
  await assert.rejects(controller.list(requestOf(undefined, ownerAuth)), (e) => e instanceof ForbiddenException);
});

test('controlador: el propietario con datos inválidos recibe 400', async () => {
  const controller = new CommunitiesController(unusedService);
  const req = requestOf(platform, ownerAuth);
  await assert.rejects(controller.create(req, { slug: 'www', name: 'X' }), (e) => e instanceof BadRequestException);
  await assert.rejects(controller.setStatus(req, 'no-es-uuid', { status: 'active' }), (e) => e instanceof BadRequestException);
  await assert.rejects(
    controller.setStatus(req, '3f8f2f0e-6f43-4b7e-8d3a-0a5c9a1b2c3d', { status: 'borrada' }),
    (e) => e instanceof BadRequestException,
  );
});

// ---------- Servicio contra PostgreSQL real ----------

let temp: TempDatabase | undefined;
let skipReason: string | undefined;
let pool: Pool;
let service: CommunitiesService;
let ownerId: string;

before(async () => {
  const created = await createTempDatabase(process.env.DATABASE_URL);
  if (!created.db) {
    skipReason = created.skipReason;
    return;
  }
  temp = created.db;
  pool = temp.pool;
  service = new CommunitiesService(pool, 'goblins.test');
  const r = await pool.query(
    `INSERT INTO users (email, display_name, password_hash, is_platform_owner)
     VALUES ('dueno@example.com', 'Dueño', 'x', true) RETURNING id`,
  );
  ownerId = r.rows[0].id;
});

after(async () => {
  await temp?.drop();
});

function skipIfNoDb(t: TestContext): boolean {
  if (!skipReason) return false;
  t.skip(skipReason);
  return true;
}

test('servicio: crea la comunidad en <slug>.<dominio base> con el propietario como admin', async (t) => {
  if (skipIfNoDb(t)) return;
  const created = await service.create({ slug: 'primero', name: 'Primero' }, 'dueno@example.com');
  assert.equal(created.host, 'primero.goblins.test');
  const role = await pool.query(`SELECT role FROM memberships WHERE community_id = $1 AND user_id = $2`, [created.id, ownerId]);
  assert.equal(role.rows[0].role, 'admin');
});

test('servicio: con adminEmail, esa cuenta es la administradora', async (t) => {
  if (skipIfNoDb(t)) return;
  const other = await pool.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ('amigo@example.com', 'Amigo', 'x') RETURNING id`,
  );
  const created = await service.create({ slug: 'del-amigo', name: 'Del amigo', adminEmail: 'amigo@example.com' }, 'dueno@example.com');
  const members = await pool.query(`SELECT user_id, role FROM memberships WHERE community_id = $1`, [created.id]);
  assert.equal(members.rowCount, 1);
  assert.equal(members.rows[0].user_id, other.rows[0].id);
  assert.equal(members.rows[0].role, 'admin');
});

test('servicio: un adminEmail inexistente o desactivado da 400 y no crea nada', async (t) => {
  if (skipIfNoDb(t)) return;
  await pool.query(
    `INSERT INTO users (email, display_name, password_hash, status) VALUES ('baja@example.com', 'Baja', 'x', 'disabled')`,
  );
  for (const adminEmail of ['nadie@example.com', 'baja@example.com']) {
    await assert.rejects(
      service.create({ slug: 'no-se-crea', name: 'X', adminEmail }, 'dueno@example.com'),
      (e) => e instanceof BadRequestException,
    );
  }
  assert.equal((await pool.query(`SELECT 1 FROM communities WHERE slug = 'no-se-crea'`)).rowCount, 0);
});

test('servicio: un slug repetido da 409', async (t) => {
  if (skipIfNoDb(t)) return;
  await service.create({ slug: 'duplicado', name: 'A' }, 'dueno@example.com');
  await assert.rejects(service.create({ slug: 'duplicado', name: 'B' }, 'dueno@example.com'), (e) => e instanceof ConflictException);
});

test('servicio: suspender y reactivar; id inexistente da 404', async (t) => {
  if (skipIfNoDb(t)) return;
  const created = await service.create({ slug: 'suspendible', name: 'S' }, 'dueno@example.com');
  assert.equal((await service.setStatus(created.id, 'suspended')).status, 'suspended');
  assert.equal((await service.setStatus(created.id, 'active')).status, 'active');
  await assert.rejects(
    service.setStatus('00000000-0000-0000-0000-000000000000', 'suspended'),
    (e) => e instanceof NotFoundException,
  );
});

test('servicio: list incluye las comunidades creadas', async (t) => {
  if (skipIfNoDb(t)) return;
  await service.create({ slug: 'para-listar', name: 'L' }, 'dueno@example.com');
  const slugs = (await service.list()).map((c) => c.slug);
  assert.ok(slugs.includes('para-listar'));
});
