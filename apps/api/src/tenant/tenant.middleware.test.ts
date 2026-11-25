import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import type { CommunityRef } from '@goblins/database';
import type { TenantRequest } from './tenant';
import { createTenantMiddleware } from './tenant.middleware';

const active: CommunityRef = { id: 'id-1', slug: 'foro1', name: 'Foro 1', status: 'active' };
const suspended: CommunityRef = { id: 'id-2', slug: 'foro2', name: 'Foro 2', status: 'suspended' };

function run(
  host: string | undefined,
  options: { allowLoopback?: boolean; path?: string; lookupError?: Error } = {},
) {
  const lookups: string[] = [];
  const middleware = createTenantMiddleware({
    baseDomain: 'localhost',
    allowLoopback: options.allowLoopback ?? true,
    skipPathPrefixes: ['/api/v1/health'],
    lookup: async (h) => {
      lookups.push(h);
      if (options.lookupError) throw options.lookupError;
      return { 'foro1.localhost': active, 'foro2.localhost': suspended }[h] ?? null;
    },
  });
  const req = { headers: host === undefined ? {} : { host }, path: options.path ?? '/api/v1/x' } as TenantRequest;
  const out: { status?: number; body?: unknown; nextCalled: boolean; nextError?: unknown } = { nextCalled: false };
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
  const next: NextFunction = (error?: unknown) => {
    out.nextCalled = true;
    out.nextError = error;
  };
  return middleware(req, res, next).then(() => ({ req, out, lookups }));
}

test('localhost es la plataforma y no consulta la base de datos', async () => {
  const { req, out, lookups } = await run('localhost:3000');
  assert.deepEqual(req.tenant, { kind: 'platform' });
  assert.equal(out.nextCalled, true);
  assert.deepEqual(lookups, []);
});

test('127.0.0.1 es la plataforma en desarrollo, pero no en producción', async () => {
  assert.deepEqual((await run('127.0.0.1:4000')).req.tenant, { kind: 'platform' });
  const prod = await run('127.0.0.1:4000', { allowLoopback: false });
  assert.equal(prod.out.status, 404);
  assert.equal(prod.out.nextCalled, false);
});

test('un subdominio registrado resuelve su comunidad (con puerto y mayúsculas)', async () => {
  const { req, out, lookups } = await run('Foro1.localhost:3000');
  assert.deepEqual(req.tenant, { kind: 'community', community: active });
  assert.equal(out.nextCalled, true);
  assert.deepEqual(lookups, ['foro1.localhost']);
});

test('un subdominio inexistente da 404 y no continúa', async () => {
  const { req, out } = await run('nadie.localhost');
  assert.equal(out.status, 404);
  assert.equal(out.nextCalled, false);
  assert.equal(req.tenant, undefined);
});

test('un host ajeno a la plataforma da 404', async () => {
  const { out } = await run('evil.com');
  assert.equal(out.status, 404);
});

test('una comunidad suspendida da 403', async () => {
  const { out, req } = await run('foro2.localhost');
  assert.equal(out.status, 403);
  assert.equal(out.nextCalled, false);
  assert.equal(req.tenant, undefined);
});

test('un Host ausente o mal formado da 400 sin consultar', async () => {
  for (const bad of [undefined, 'a b', 'x..y']) {
    const { out, lookups } = await run(bad);
    assert.equal(out.status, 400, String(bad));
    assert.deepEqual(lookups, []);
  }
});

test('las sondas de salud funcionan con cualquier Host', async () => {
  const { req, out, lookups } = await run('cualquier-cosa.interna', { path: '/api/v1/health/ready' });
  assert.deepEqual(req.tenant, { kind: 'platform' });
  assert.equal(out.nextCalled, true);
  assert.deepEqual(lookups, []);
});

test('si la base de datos falla, el error pasa a next y no se resuelve nada', async () => {
  const boom = new Error('db caída');
  const { req, out } = await run('foro1.localhost', { lookupError: boom });
  assert.equal(out.nextError, boom);
  assert.equal(req.tenant, undefined);
});
