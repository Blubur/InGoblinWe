import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHost, normalizeHost } from './host';

test('normalizeHost quita puerto, punto final y mayúsculas', () => {
  assert.equal(normalizeHost('Foro1.LOCALHOST:3000'), 'foro1.localhost');
  assert.equal(normalizeHost('foro1.localhost.'), 'foro1.localhost');
  assert.equal(normalizeHost('localhost'), 'localhost');
  assert.equal(normalizeHost('127.0.0.1:4000'), '127.0.0.1');
});

test('normalizeHost entiende IPv6 entre corchetes', () => {
  assert.equal(normalizeHost('[::1]:4000'), '::1');
  assert.equal(normalizeHost('[::1]'), '::1');
});

test('normalizeHost rechaza valores que no son un host', () => {
  for (const bad of [undefined, null, '', ' ', 'a b.localhost', 'foro_1.localhost', 'a..b', '.a', '-a.localhost', 'a.localhost:abc', 'a:1:2', '[::1', 'a/b', 'a@b.com', '[zz]'] as const) {
    assert.equal(normalizeHost(bad), null, `debería rechazar ${String(bad)}`);
  }
  assert.equal(normalizeHost('a'.repeat(64) + '.localhost'), null);
});

test('classifyHost: el dominio base es la plataforma, lo demás es comunidad', () => {
  const opts = { baseDomain: 'localhost', allowLoopback: false };
  assert.equal(classifyHost('localhost', opts), 'platform');
  assert.equal(classifyHost('foro1.localhost', opts), 'community');
  assert.equal(classifyHost('evil.com', opts), 'community');
});

test('classifyHost: el loopback solo es plataforma si se permite', () => {
  assert.equal(classifyHost('127.0.0.1', { baseDomain: 'localhost', allowLoopback: true }), 'platform');
  assert.equal(classifyHost('::1', { baseDomain: 'localhost', allowLoopback: true }), 'platform');
  assert.equal(classifyHost('127.0.0.1', { baseDomain: 'localhost', allowLoopback: false }), 'community');
});
