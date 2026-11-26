import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { loadRootEnv } from '@goblins/core';
import { createTempDatabase, type Pool, type TempDatabase } from '@goblins/database';
import type { AuthContext, AuthRequest } from '../auth/auth';
import type { Tenant } from '../tenant/tenant';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { updateUserSchema } from './schemas';

loadRootEnv();

// ---------- Esquema ----------

test('esquema: canCreateCommunities es obligatorio y booleano', () => {
  assert.equal(updateUserSchema.safeParse({ canCreateCommunities: true }).success, true);
  assert.equal(updateUserSchema.safeParse({ canCreateCommunities: false }).success, true);
  for (const bad of [{}, { canCreateCommunities: 'true' }, { canCreateCommunities: 1 }, { canCreateCommunities: null }]) {
    assert.equal(updateUserSchema.safeParse(bad).success, false);
  }
});

// ---------- Controlador (con servicio simulado) ----------

const calls: { method: string; args: unknown[] }[] = [];
const fakeService = {
  listUsers: async () => {
    calls.push({ method: 'listUsers', args: [] });
    return [];
  },
  setCanCreateCommunities: async (...args: unknown[]) => {
    calls.push({ method: 'setCanCreateCommunities', args });
    return { id: args[0] };
  },
} as unknown as PlatformService;

const ownerAuth: AuthContext = { userId: 'u1', email: 'dueno@example.com', displayName: 'Dueño', role: 'owner', canCreateCommunities: true, csrfToken: 'x' };
const userAuth: AuthContext = { ...ownerAuth, userId: 'u2', role: 'user', canCreateCommunities: true };
const platform: Tenant = { kind: 'platform' };
const inCommunity: Tenant = { kind: 'community', community: { id: 'c1', slug: 'foro', name: 'Foro', status: 'active' } };
const requestOf = (tenant: Tenant | undefined, auth?: AuthContext) => ({ tenant, auth }) as unknown as AuthRequest;
const USER_ID = '3f8f2f0e-6f43-4b7e-8d3a-0a5c9a1b2c3d';

test('controlador: sin sesión 401; cuenta normal, miembro o desde una comunidad, 403; el servicio no se toca', async () => {
  calls.length = 0;
  const controller = new PlatformController(fakeService);
  const body = { canCreateCommunities: true };
  await assert.rejects(controller.list(requestOf(platform)), (e) => e instanceof UnauthorizedException);
  await assert.rejects(controller.update(requestOf(platform), USER_ID, body), (e) => e instanceof UnauthorizedException);
  for (const auth of [userAuth, { ...userAuth, role: 'admin' as const }, { ...userAuth, role: 'member' as const }]) {
    await assert.rejects(controller.list(requestOf(platform, auth)), (e) => e instanceof ForbiddenException);
    await assert.rejects(controller.update(requestOf(platform, auth), USER_ID, body), (e) => e instanceof ForbiddenException);
  }
  // Ni siendo propietario desde el host de una comunidad.
  await assert.rejects(controller.list(requestOf(inCommunity, ownerAuth)), (e) => e instanceof ForbiddenException);
  await assert.rejects(controller.update(requestOf(inCommunity, ownerAuth), USER_ID, body), (e) => e instanceof ForbiddenException);
  assert.equal(calls.length, 0);
});

test('controlador: el propietario lista y cambia el interruptor; datos inválidos dan 400', async () => {
  calls.length = 0;
  const controller = new PlatformController(fakeService);
  const req = requestOf(platform, ownerAuth);
  assert.deepEqual(await controller.list(req), { users: [] });
  await controller.update(req, USER_ID, { canCreateCommunities: false });
  assert.deepEqual(calls[1], { method: 'setCanCreateCommunities', args: [USER_ID, false] });
  await assert.rejects(controller.update(req, 'no-es-uuid', { canCreateCommunities: true }), (e) => e instanceof BadRequestException);
  await assert.rejects(controller.update(req, USER_ID, { canCreateCommunities: 'si' }), (e) => e instanceof BadRequestException);
  assert.equal(calls.length, 2);
});

// ---------- Servicio contra PostgreSQL real ----------

let temp: TempDatabase | undefined;
let skipReason: string | undefined;
let pool: Pool;
let service: PlatformService;

before(async () => {
  const created = await createTempDatabase(process.env.DATABASE_URL);
  if (!created.db) {
    skipReason = created.skipReason;
    return;
  }
  temp = created.db;
  pool = temp.pool;
  service = new PlatformService(pool);
});

after(async () => {
  await temp?.drop();
});

function skipIfNoDb(t: TestContext): boolean {
  if (!skipReason) return false;
  t.skip(skipReason);
  return true;
}

test('servicio: activa y retira el permiso y devuelve la cuenta actualizada sin el hash', async (t) => {
  if (skipIfNoDb(t)) return;
  const r = await pool.query(
    `INSERT INTO users (email, display_name, password_hash) VALUES ('amigo-permiso@example.com', 'Amigo', 'x') RETURNING id`,
  );
  const id = r.rows[0].id as string;
  const on = await service.setCanCreateCommunities(id, true);
  assert.equal(on.canCreateCommunities, true);
  assert.equal(on.email, 'amigo-permiso@example.com');
  assert.ok(!('passwordHash' in on));
  assert.equal((await service.setCanCreateCommunities(id, false)).canCreateCommunities, false);
  assert.ok((await service.listUsers()).some((u) => u.id === id));
});

test('servicio: una cuenta inexistente da 404', async (t) => {
  if (skipIfNoDb(t)) return;
  await assert.rejects(
    service.setCanCreateCommunities('00000000-0000-0000-0000-000000000000', true),
    (e) => e instanceof NotFoundException,
  );
});
