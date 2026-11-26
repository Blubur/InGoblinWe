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

const ownerAuth: AuthContext = { userId: 'u1', email: 'dueno@example.com', displayName: 'Dueño', role: 'owner', canCreateCommunities: true, csrfToken: 'x' };
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

// ---------- Controlador: cuentas normales con y sin permiso de creador ----------

const userAuth: AuthContext = { userId: 'u2', email: 'Amigo@example.com', displayName: 'Amigo', role: 'user', canCreateCommunities: false, csrfToken: 'x' };
const creatorAuth: AuthContext = { ...userAuth, canCreateCommunities: true };

function recordingService() {
  const calls: { method: string; args: unknown[] }[] = [];
  const service = {
    create: async (...args: unknown[]) => {
      calls.push({ method: 'create', args });
      return { id: 'c1', slug: 'foro', name: 'X', status: 'active', host: 'foro.goblins.test' };
    },
    list: async (...args: unknown[]) => {
      calls.push({ method: 'list', args });
      return [];
    },
    listAdministeredBy: async (...args: unknown[]) => {
      calls.push({ method: 'listAdministeredBy', args });
      return [];
    },
    setStatus: async (...args: unknown[]) => {
      calls.push({ method: 'setStatus', args });
      return { id: 'c1', slug: 'foro', name: 'X', status: 'suspended' };
    },
  } as unknown as CommunitiesService;
  return { service, calls };
}

const COMMUNITY_ID = '3f8f2f0e-6f43-4b7e-8d3a-0a5c9a1b2c3d';

test('controlador: una cuenta sin permiso de creador no puede crear (403) y el servicio no se toca', async () => {
  const { service, calls } = recordingService();
  const controller = new CommunitiesController(service);
  await assert.rejects(
    controller.create(requestOf(platform, userAuth), { slug: 'foro', name: 'X' }),
    (e) => e instanceof ForbiddenException,
  );
  assert.equal(calls.length, 0);
});

test('controlador: una cuenta con permiso crea y es su propia administradora', async () => {
  const { service, calls } = recordingService();
  const controller = new CommunitiesController(service);
  await controller.create(requestOf(platform, creatorAuth), { slug: 'foro', name: 'X' });
  assert.equal(calls[0]?.method, 'create');
  assert.equal(calls[0]?.args[1], creatorAuth.email);
  // Indicar su propio email como administrador es redundante, pero no es un error (da igual mayúsculas).
  await controller.create(requestOf(platform, creatorAuth), { slug: 'foro', name: 'X', adminEmail: 'amigo@example.com' });
  assert.equal(calls.length, 2);
});

test('controlador: un creador no puede nombrar administrador a otra cuenta, pero el propietario sí', async () => {
  const { service, calls } = recordingService();
  const controller = new CommunitiesController(service);
  await assert.rejects(
    controller.create(requestOf(platform, creatorAuth), { slug: 'foro', name: 'X', adminEmail: 'otro@example.com' }),
    (e) => e instanceof ForbiddenException,
  );
  assert.equal(calls.length, 0);
  await controller.create(requestOf(platform, ownerAuth), { slug: 'foro', name: 'X', adminEmail: 'otro@example.com' });
  assert.equal(calls.length, 1);
});

test('controlador: el listado completo es solo del propietario; una cuenta normal usa /mine', async () => {
  const { service, calls } = recordingService();
  const controller = new CommunitiesController(service);
  await assert.rejects(controller.list(requestOf(platform, creatorAuth)), (e) => e instanceof ForbiddenException);
  assert.equal(calls.length, 0);

  await controller.listMine(requestOf(platform, userAuth));
  assert.deepEqual(calls[0], { method: 'listAdministeredBy', args: ['u2'] });
  // El propietario también ve solo las suyas en /mine.
  await controller.listMine(requestOf(platform, ownerAuth));
  assert.deepEqual(calls[1], { method: 'listAdministeredBy', args: ['u1'] });
});

test('controlador: /mine exige sesión del panel central', async () => {
  const controller = new CommunitiesController(unusedService);
  await assert.rejects(controller.listMine(requestOf(platform)), (e) => e instanceof UnauthorizedException);
  await assert.rejects(controller.listMine(requestOf(inCommunity, userAuth)), (e) => e instanceof ForbiddenException);
  await assert.rejects(
    controller.listMine(requestOf(platform, { ...userAuth, role: 'member' })),
    (e) => e instanceof ForbiddenException,
  );
});

test('controlador: el cambio de estado pasa quién lo pide al servicio', async () => {
  const { service, calls } = recordingService();
  const controller = new CommunitiesController(service);
  await controller.setStatus(requestOf(platform, userAuth), COMMUNITY_ID, { status: 'suspended' });
  assert.deepEqual(calls[0]?.args, [COMMUNITY_ID, 'suspended', { userId: 'u2', isOwner: false }]);
  await controller.setStatus(requestOf(platform, ownerAuth), COMMUNITY_ID, { status: 'active' });
  assert.deepEqual(calls[1]?.args, [COMMUNITY_ID, 'active', { userId: 'u1', isOwner: true }]);
  await assert.rejects(
    controller.setStatus(requestOf(platform), COMMUNITY_ID, { status: 'active' }),
    (e) => e instanceof UnauthorizedException,
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
  const asOwner = { userId: ownerId, isOwner: true };
  assert.equal((await service.setStatus(created.id, 'suspended', asOwner)).status, 'suspended');
  assert.equal((await service.setStatus(created.id, 'active', asOwner)).status, 'active');
  await assert.rejects(
    service.setStatus('00000000-0000-0000-0000-000000000000', 'suspended', asOwner),
    (e) => e instanceof NotFoundException,
  );
});

test('servicio: list incluye las comunidades creadas', async (t) => {
  if (skipIfNoDb(t)) return;
  await service.create({ slug: 'para-listar', name: 'L' }, 'dueno@example.com');
  const slugs = (await service.list()).map((c) => c.slug);
  assert.ok(slugs.includes('para-listar'));
});

test('servicio: una cuenta normal solo cambia el estado de las comunidades que administra', async (t) => {
  if (skipIfNoDb(t)) return;
  const mk = async (email: string) =>
    (await pool.query(`INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'P', 'x') RETURNING id`, [email])).rows[0].id as string;
  const ana = await mk('ana-estado@example.com');
  const beto = await mk('beto-estado@example.com');
  const deAna = await service.create({ slug: 'estado-de-ana', name: 'A' }, 'ana-estado@example.com');
  const deBeto = await service.create({ slug: 'estado-de-beto', name: 'B' }, 'beto-estado@example.com');
  const asAna = { userId: ana, isOwner: false };

  assert.equal((await service.setStatus(deAna.id, 'suspended', asAna)).status, 'suspended');
  assert.equal((await service.setStatus(deAna.id, 'active', asAna)).status, 'active');
  // La de Beto: mismo 404 que si no existiera, y no cambia.
  await assert.rejects(service.setStatus(deBeto.id, 'suspended', asAna), (e) => e instanceof NotFoundException);
  const row = await pool.query(`SELECT status FROM communities WHERE id = $1`, [deBeto.id]);
  assert.equal(row.rows[0].status, 'active');

  // Ser solo miembro (no admin) tampoco basta.
  await pool.query(`INSERT INTO memberships (community_id, user_id, role) VALUES ($1, $2, 'member')`, [deBeto.id, ana]);
  await assert.rejects(service.setStatus(deBeto.id, 'suspended', asAna), (e) => e instanceof NotFoundException);

  // El propietario sí puede con cualquiera.
  assert.equal((await service.setStatus(deBeto.id, 'suspended', { userId: beto, isOwner: true })).status, 'suspended');
});

test('servicio: listAdministeredBy devuelve solo las comunidades que administra la cuenta', async (t) => {
  if (skipIfNoDb(t)) return;
  const u = await pool.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ('lista-mias@example.com', 'L', 'x') RETURNING id`,
  );
  await service.create({ slug: 'mia-1', name: 'M1' }, 'lista-mias@example.com');
  await service.create({ slug: 'mia-2', name: 'M2' }, 'lista-mias@example.com');
  const mine = (await service.listAdministeredBy(u.rows[0].id)).map((c) => c.slug).sort();
  assert.deepEqual(mine, ['mia-1', 'mia-2']);
});
