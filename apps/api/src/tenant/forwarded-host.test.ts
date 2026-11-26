import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import type { CommunityRef } from '@goblins/database';
import { FORWARDED_HOST_HEADER, PROXY_SECRET_HEADER, resolveEffectiveHost } from './forwarded-host';
import type { TenantRequest } from './tenant';
import { createTenantMiddleware } from './tenant.middleware';

const SECRET = 's'.repeat(40);

// ---------- Función pura ----------

test('sin secreto configurado se usa Host y se ignora el host reenviado', () => {
  const result = resolveEffectiveHost(
    { host: '127.0.0.1:4000', [FORWARDED_HOST_HEADER]: 'foro1.localhost:3000', [PROXY_SECRET_HEADER]: SECRET },
    undefined,
  );
  assert.deepEqual(result, { ok: true, host: '127.0.0.1:4000' });
});

test('con secreto y sin host reenviado se usa Host', () => {
  assert.deepEqual(resolveEffectiveHost({ host: 'api.interna:4000' }, SECRET), { ok: true, host: 'api.interna:4000' });
});

test('con secreto correcto se usa el host reenviado', () => {
  const result = resolveEffectiveHost(
    { host: 'api.interna:4000', [FORWARDED_HOST_HEADER]: 'foro1.localhost:3000', [PROXY_SECRET_HEADER]: SECRET },
    SECRET,
  );
  assert.deepEqual(result, { ok: true, host: 'foro1.localhost:3000' });
});

test('con secreto, un host reenviado sin secreto o con secreto incorrecto se rechaza', () => {
  for (const headers of [
    { host: 'api.interna', [FORWARDED_HOST_HEADER]: 'foro1.localhost' },
    { host: 'api.interna', [FORWARDED_HOST_HEADER]: 'foro1.localhost', [PROXY_SECRET_HEADER]: 'x'.repeat(40) },
    { host: 'api.interna', [FORWARDED_HOST_HEADER]: 'foro1.localhost', [PROXY_SECRET_HEADER]: '' },
  ]) {
    assert.equal(resolveEffectiveHost(headers, SECRET).ok, false);
  }
});

// ---------- Integrado en el middleware de tenant ----------

const foro1: CommunityRef = { id: 'id-1', slug: 'foro1', name: 'Foro 1', status: 'active' };

async function run(headers: Record<string, string>, proxySecret: string | undefined) {
  const middleware = createTenantMiddleware({
    baseDomain: 'goblins.test',
    allowLoopback: false,
    proxySecret,
    lookup: async (host) => (host === 'foro1.goblins.test' ? foro1 : null),
  });
  const req = { headers, path: '/api/v1/auth/login' } as unknown as TenantRequest;
  const out: { status?: number; body?: unknown; nextCalled: boolean } = { nextCalled: false };
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
  await middleware(req as unknown as Request, res, next);
  return { req, out };
}

test('middleware: el proxy autorizado puede dirigir la petición a una comunidad', async () => {
  const { req, out } = await run(
    { host: 'api.interna', [FORWARDED_HOST_HEADER]: 'foro1.goblins.test', [PROXY_SECRET_HEADER]: SECRET },
    SECRET,
  );
  assert.equal(out.nextCalled, true);
  assert.deepEqual(req.tenant, { kind: 'community', community: foro1 });
  assert.equal(req.effectiveHost, 'foro1.goblins.test');
});

test('middleware: el proxy autorizado puede dirigir la petición al panel central', async () => {
  const { req, out } = await run(
    { host: 'api.interna', [FORWARDED_HOST_HEADER]: 'goblins.test', [PROXY_SECRET_HEADER]: SECRET },
    SECRET,
  );
  assert.equal(out.nextCalled, true);
  assert.deepEqual(req.tenant, { kind: 'platform' });
});

test('middleware: un cliente que reenvía un host sin el secreto recibe 403 y no se resuelve nada', async () => {
  const { req, out } = await run({ host: 'api.interna', [FORWARDED_HOST_HEADER]: 'goblins.test' }, SECRET);
  assert.equal(out.status, 403);
  assert.equal(out.nextCalled, false);
  assert.equal(req.tenant, undefined);
});

test('middleware: sin secreto configurado el host reenviado no cambia nada (aquí daría 404)', async () => {
  const { out } = await run(
    { host: 'api.interna', [FORWARDED_HOST_HEADER]: 'goblins.test', [PROXY_SECRET_HEADER]: SECRET },
    undefined,
  );
  assert.equal(out.status, 404);
  assert.equal(out.nextCalled, false);
});

test('middleware: un host reenviado mal formado da 400', async () => {
  const { out } = await run(
    { host: 'api.interna', [FORWARDED_HOST_HEADER]: 'no valido!', [PROXY_SECRET_HEADER]: SECRET },
    SECRET,
  );
  assert.equal(out.status, 400);
  assert.equal(out.nextCalled, false);
});
