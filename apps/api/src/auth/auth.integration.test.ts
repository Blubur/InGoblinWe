import { after, before, test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Response } from 'express';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { loadRootEnv } from '@goblins/core';
import { createTempDatabase, setCanCreateCommunities, type Pool, type TempDatabase } from '@goblins/database';
import type { Tenant } from '../tenant/tenant';
import type { AuthRequest } from './auth';
import { createAuthMiddleware } from './auth.middleware';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password';
import { hashToken } from './tokens';

loadRootEnv();

let temp: TempDatabase | undefined;
let skipReason: string | undefined;
let pool: Pool;
let service: AuthService;
let foroA: Tenant;
let foroB: Tenant;
const platform: Tenant = { kind: 'platform' };

before(async () => {
  const created = await createTempDatabase(process.env.DATABASE_URL);
  if (!created.db) {
    skipReason = created.skipReason;
    return;
  }
  temp = created.db;
  pool = temp.pool;
  service = new AuthService(pool, new PasswordHasher({ memoryCost: 8, timeCost: 1 }), { sessionTtlSeconds: 3600 });
  const make = async (slug: string): Promise<Tenant> => {
    const r = await pool.query(`INSERT INTO communities (slug, name) VALUES ($1, $1) RETURNING id`, [slug]);
    return { kind: 'community', community: { id: r.rows[0].id, slug, name: slug, status: 'active' } };
  };
  foroA = await make('foro-a');
  foroB = await make('foro-b');
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
const newEmail = () => `user${++counter}@example.com`;
const PASSWORD = 'contraseña-segura-1';

const register = (tenant: Tenant, email: string, password = PASSWORD) =>
  service.register(tenant, { email, displayName: 'Persona', password });

async function rejectsWith(promise: Promise<unknown>, type: new (...args: never[]) => Error): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof type);
}

// ---------- Registro ----------

test('registrar crea usuario, membresía y sesión; el token no se guarda en claro', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  const { token, auth } = await register(foroA, email);
  assert.equal(auth.role, 'member');

  const user = await pool.query(`SELECT password_hash FROM users WHERE email = $1`, [email]);
  assert.match(user.rows[0].password_hash, /^\$argon2id\$/);
  assert.ok(!user.rows[0].password_hash.includes(PASSWORD));

  const stored = await pool.query(`SELECT token_hash FROM sessions WHERE user_id = $1`, [auth.userId]);
  assert.equal(stored.rows[0].token_hash, hashToken(token));
  assert.notEqual(stored.rows[0].token_hash, token);
});

test('registrar con un email existente y contraseña incorrecta falla sin dar pistas', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(foroA, email);
  await rejectsWith(register(foroB, email, 'otra-contraseña-distinta'), ConflictException);
  const members = await pool.query(`SELECT count(*)::int AS n FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1`, [email]);
  assert.equal(members.rows[0].n, 1);
});

test('la cuenta es global: con la contraseña correcta se une a otra comunidad', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  const first = await register(foroA, email);
  const second = await register(foroB, email);
  assert.equal(second.auth.userId, first.auth.userId);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email])).rows[0].n, 1);
});

test('registrarse dos veces en la misma comunidad da conflicto', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(foroA, email);
  await rejectsWith(register(foroA, email), ConflictException);
});

test('registrar el mismo email a la vez deja una sola cuenta', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  const results = await Promise.allSettled([register(foroA, email), register(foroA, email), register(foroB, email)]);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [email])).rows[0].n, 1);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
});

test('registro en el panel central: crea una cuenta global sin permiso de crear ni membresías', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  const { token, auth } = await register(platform, email);
  assert.equal(auth.role, 'user');
  assert.equal(auth.canCreateCommunities, false);
  const row = await pool.query(`SELECT id, can_create_communities, is_platform_owner FROM users WHERE email = $1`, [email]);
  assert.equal(row.rows[0].can_create_communities, false);
  assert.equal(row.rows[0].is_platform_owner, false);
  const memberships = await pool.query(`SELECT count(*)::int AS n FROM memberships WHERE user_id = $1`, [row.rows[0].id]);
  assert.equal(memberships.rows[0].n, 0);
  assert.equal((await service.resolve(platform, token))?.email, email);
});

test('registro en el panel central: un email ya existente no revela nada y no abre sesión', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(platform, email);
  // Misma contraseña: ya tiene cuenta, que inicie sesión.
  await rejectsWith(register(platform, email), ConflictException);
  // Contraseña ajena: mismo tipo de error, sin sesión.
  await rejectsWith(register(platform, email, 'otra-contraseña-larga-2'), ConflictException);
});

test('registro en el panel central: una cuenta de una comunidad no se registra de nuevo, pero entra con login', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(foroA, email);
  await rejectsWith(register(platform, email), ConflictException);
  const { auth } = await service.login(platform, { email, password: PASSWORD });
  assert.equal(auth.role, 'user');
});

// ---------- Login ----------

test('login correcto abre sesión; incorrecto y usuario inexistente dan el mismo error', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(foroA, email);
  const ok = await service.login(foroA, { email, password: PASSWORD });
  assert.equal(ok.auth.email, email);

  const messages: string[] = [];
  for (const input of [
    { email, password: 'incorrecta-incorrecta' },
    { email: 'nadie@example.com', password: PASSWORD },
  ]) {
    await assert.rejects(service.login(foroA, input), (error: unknown) => {
      assert.ok(error instanceof UnauthorizedException);
      messages.push(error.message);
      return true;
    });
  }
  assert.equal(messages[0], messages[1]);
});

test('login: una cuenta desactivada no puede entrar', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(foroA, email);
  await pool.query(`UPDATE users SET status = 'disabled' WHERE email = $1`, [email]);
  await rejectsWith(service.login(foroA, { email, password: PASSWORD }), UnauthorizedException);
});

test('login: quien no es miembro de la comunidad recibe 403', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(foroA, email);
  await rejectsWith(service.login(foroB, { email, password: PASSWORD }), ForbiddenException);
});

test('panel central: el propietario entra como owner y puede crear siempre; el resto como user', async (t) => {
  if (skipIfNoDb(t)) return;
  const normal = newEmail();
  await register(foroA, normal);
  const asUser = await service.login(platform, { email: normal, password: PASSWORD });
  assert.equal(asUser.auth.role, 'user');
  assert.equal(asUser.auth.canCreateCommunities, false);

  const owner = newEmail();
  const hash = await new PasswordHasher({ memoryCost: 8, timeCost: 1 }).hash(PASSWORD);
  await pool.query(
    `INSERT INTO users (email, display_name, password_hash, is_platform_owner) VALUES ($1, 'Dueño', $2, true)`,
    [owner, hash],
  );
  const { auth } = await service.login(platform, { email: owner, password: PASSWORD });
  assert.equal(auth.role, 'owner');
  assert.equal(auth.canCreateCommunities, true);
});

test('panel central: una cuenta desactivada no entra', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(platform, email);
  await pool.query(`UPDATE users SET status = 'disabled' WHERE email = $1`, [email]);
  await rejectsWith(service.login(platform, { email, password: PASSWORD }), UnauthorizedException);
});

test('el permiso de crear comunidades se activa y se retira en caliente, sin volver a iniciar sesión', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  const { token, auth } = await register(platform, email);
  assert.equal((await service.resolve(platform, token))?.canCreateCommunities, false);

  assert.equal(await setCanCreateCommunities(pool, auth.userId, true), true);
  const enabled = await service.resolve(platform, token);
  assert.equal(enabled?.role, 'user');
  assert.equal(enabled?.canCreateCommunities, true);

  await setCanCreateCommunities(pool, auth.userId, false);
  assert.equal((await service.resolve(platform, token))?.canCreateCommunities, false);
});

test('el permiso de crear comunidades no se hereda dentro de una comunidad', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  const { auth } = await register(foroA, email);
  await setCanCreateCommunities(pool, auth.userId, true);
  const inCommunity = await service.login(foroA, { email, password: PASSWORD });
  assert.equal(inCommunity.auth.role, 'member');
  assert.equal(inCommunity.auth.canCreateCommunities, false);
});

test('la sesión del panel central de una cuenta normal no vale en ninguna comunidad, ni siendo miembro', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  await register(foroA, email);
  const { token } = await service.login(platform, { email, password: PASSWORD });
  assert.ok(await service.resolve(platform, token));
  assert.equal(await service.resolve(foroA, token), null);
  assert.equal(await service.resolve(foroB, token), null);
});

// ---------- Sesiones y aislamiento ----------

test('una sesión vale en su comunidad y no en otra', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  const { token } = await register(foroA, email);
  assert.equal((await service.resolve(foroA, token))?.email, email);
  assert.equal(await service.resolve(foroB, token), null);
  assert.equal(await service.resolve(platform, token), null);
});

test('una sesión del panel central no vale en una comunidad', async (t) => {
  if (skipIfNoDb(t)) return;
  const owner = newEmail();
  const hash = await new PasswordHasher({ memoryCost: 8, timeCost: 1 }).hash(PASSWORD);
  const u = await pool.query(
    `INSERT INTO users (email, display_name, password_hash, is_platform_owner) VALUES ($1, 'Dueño', $2, true) RETURNING id`,
    [owner, hash],
  );
  await pool.query(`INSERT INTO memberships (community_id, user_id) VALUES ($1, $2)`, [(foroA as { community: { id: string } }).community.id, u.rows[0].id]);
  const { token } = await service.login(platform, { email: owner, password: PASSWORD });
  assert.ok(await service.resolve(platform, token));
  assert.equal(await service.resolve(foroA, token), null);
});

test('logout invalida la sesión', async (t) => {
  if (skipIfNoDb(t)) return;
  const { token } = await register(foroA, newEmail());
  assert.ok(await service.resolve(foroA, token));
  await service.logout(token);
  assert.equal(await service.resolve(foroA, token), null);
});

test('una sesión caducada no vale', async (t) => {
  if (skipIfNoDb(t)) return;
  const { token } = await register(foroA, newEmail());
  await pool.query(`UPDATE sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE token_hash = $1`, [hashToken(token)]);
  assert.equal(await service.resolve(foroA, token), null);
});

test('si se quita la membresía o se desactiva la cuenta, la sesión deja de valer al instante', async (t) => {
  if (skipIfNoDb(t)) return;
  const a = await register(foroA, newEmail());
  await pool.query(`DELETE FROM memberships WHERE user_id = $1`, [a.auth.userId]);
  assert.equal(await service.resolve(foroA, a.token), null);

  const b = await register(foroA, newEmail());
  await pool.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [b.auth.userId]);
  assert.equal(await service.resolve(foroA, b.token), null);
});

test('un token inventado no resuelve nada', async (t) => {
  if (skipIfNoDb(t)) return;
  assert.equal(await service.resolve(foroA, 'token-inventado'), null);
});

// ---------- Middleware: CSRF y Origin ----------

interface Outcome {
  status?: number;
  body?: unknown;
  nextCalled: boolean;
  req: AuthRequest;
}

async function callMiddleware(
  tenant: Tenant,
  request: { method: string; host?: string; origin?: string; cookie?: string; csrf?: string; effectiveHost?: string },
): Promise<Outcome> {
  const middleware = createAuthMiddleware({ service, cookieName: 'goblins_session' });
  const headers: Record<string, string> = {};
  if (request.host) headers.host = request.host;
  if (request.origin) headers.origin = request.origin;
  if (request.cookie) headers.cookie = request.cookie;
  if (request.csrf) headers['x-csrf-token'] = request.csrf;
  const req = { method: request.method, headers, tenant, effectiveHost: request.effectiveHost } as unknown as AuthRequest;
  const out: Outcome = { nextCalled: false, req };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: unknown) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  const next: NextFunction = () => {
    out.nextCalled = true;
  };
  await middleware(req, res, next);
  return out;
}

test('middleware: GET con sesión válida rellena req.auth', async (t) => {
  if (skipIfNoDb(t)) return;
  const { token, auth } = await register(foroA, newEmail());
  const out = await callMiddleware(foroA, { method: 'GET', host: 'foro-a.localhost', cookie: `goblins_session=${token}` });
  assert.equal(out.nextCalled, true);
  assert.equal(out.req.auth?.userId, auth.userId);
});

test('middleware: sin cookie o con cookie falsa sigue como anónimo', async (t) => {
  if (skipIfNoDb(t)) return;
  for (const cookie of [undefined, 'goblins_session=falsa']) {
    const out = await callMiddleware(foroA, { method: 'GET', host: 'foro-a.localhost', cookie });
    assert.equal(out.nextCalled, true);
    assert.equal(out.req.auth, undefined);
  }
});

test('middleware: POST con sesión y sin token CSRF se rechaza', async (t) => {
  if (skipIfNoDb(t)) return;
  const { token } = await register(foroA, newEmail());
  const out = await callMiddleware(foroA, { method: 'POST', host: 'foro-a.localhost', cookie: `goblins_session=${token}` });
  assert.equal(out.status, 403);
  assert.equal(out.nextCalled, false);
});

test('middleware: POST con token CSRF de otra sesión se rechaza', async (t) => {
  if (skipIfNoDb(t)) return;
  const mine = await register(foroA, newEmail());
  const other = await register(foroA, newEmail());
  const out = await callMiddleware(foroA, {
    method: 'POST',
    host: 'foro-a.localhost',
    cookie: `goblins_session=${mine.token}`,
    csrf: other.auth.csrfToken,
  });
  assert.equal(out.status, 403);
  assert.equal(out.nextCalled, false);
});

test('middleware: POST con sesión y token CSRF correcto pasa', async (t) => {
  if (skipIfNoDb(t)) return;
  const { token, auth } = await register(foroA, newEmail());
  const out = await callMiddleware(foroA, {
    method: 'POST',
    host: 'foro-a.localhost',
    origin: 'http://foro-a.localhost:3000',
    cookie: `goblins_session=${token}`,
    csrf: auth.csrfToken,
  });
  assert.equal(out.nextCalled, true);
  assert.equal(out.req.auth?.userId, auth.userId);
});

test('middleware: POST desde un Origin ajeno se rechaza aunque el token CSRF sea correcto', async (t) => {
  if (skipIfNoDb(t)) return;
  const { token, auth } = await register(foroA, newEmail());
  const out = await callMiddleware(foroA, {
    method: 'POST',
    host: 'foro-a.localhost',
    origin: 'https://evil.com',
    cookie: `goblins_session=${token}`,
    csrf: auth.csrfToken,
  });
  assert.equal(out.status, 403);
  assert.equal(out.nextCalled, false);
});

test('middleware: POST anónimo (login) desde un Origin ajeno se rechaza; sin Origin pasa', async (t) => {
  if (skipIfNoDb(t)) return;
  const evil = await callMiddleware(foroA, { method: 'POST', host: 'foro-a.localhost', origin: 'https://evil.com' });
  assert.equal(evil.status, 403);
  const none = await callMiddleware(foroA, { method: 'POST', host: 'foro-a.localhost' });
  assert.equal(none.nextCalled, true);
});

test('middleware: la cookie de otra comunidad no autentica', async (t) => {
  if (skipIfNoDb(t)) return;
  const { token } = await register(foroA, newEmail());
  const out = await callMiddleware(foroB, { method: 'GET', host: 'foro-b.localhost', cookie: `goblins_session=${token}` });
  assert.equal(out.nextCalled, true);
  assert.equal(out.req.auth, undefined);
});

test('quien es miembro de dos comunidades no puede usar la sesión de una en la otra', async (t) => {
  if (skipIfNoDb(t)) return;
  const email = newEmail();
  const inA = await register(foroA, email);
  await register(foroB, email); // misma cuenta, miembro de ambas
  assert.ok(await service.resolve(foroA, inA.token));
  assert.equal(await service.resolve(foroB, inA.token), null);
});

test('middleware: el Origin se compara con el host efectivo (el reenviado por el proxy), no con el Host interno', async (t) => {
  if (skipIfNoDb(t)) return;
  const viaProxy = await callMiddleware(foroA, {
    method: 'POST',
    host: 'api.interna',
    effectiveHost: 'foro-a.localhost',
    origin: 'http://foro-a.localhost:3000',
  });
  assert.equal(viaProxy.nextCalled, true);

  const wrongOrigin = await callMiddleware(foroA, {
    method: 'POST',
    host: 'api.interna',
    effectiveHost: 'foro-a.localhost',
    origin: 'https://evil.com',
  });
  assert.equal(wrongOrigin.status, 403);

  // Sin host efectivo se sigue usando Host, como antes.
  const direct = await callMiddleware(foroA, { method: 'POST', host: 'api.interna', origin: 'http://foro-a.localhost:3000' });
  assert.equal(direct.status, 403);
});
