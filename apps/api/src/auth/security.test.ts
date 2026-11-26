import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PasswordHasher } from './password';
import { isOriginAllowed } from './origin';
import { readCookie, sessionCookieName, sessionCookieOptions } from './session-cookie';
import { deriveCsrfToken, generateSessionToken, hashToken, safeEqual } from './tokens';

// Parámetros mínimos: aquí se prueba la lógica, no la dureza del hash.
const fast = new PasswordHasher({ memoryCost: 8, timeCost: 1 });

test('la contraseña se guarda con Argon2id y nunca en claro', async () => {
  const hash = await fast.hash('una-contraseña-larga');
  assert.match(hash, /^\$argon2id\$/);
  assert.ok(!hash.includes('una-contraseña-larga'));
});

test('verify acepta la contraseña correcta y rechaza la incorrecta', async () => {
  const hash = await fast.hash('una-contraseña-larga');
  assert.equal(await fast.verify(hash, 'una-contraseña-larga'), true);
  assert.equal(await fast.verify(hash, 'otra-contraseña-larga'), false);
});

test('dos hashes de la misma contraseña son distintos (sal aleatoria)', async () => {
  assert.notEqual(await fast.hash('misma-contraseña-1'), await fast.hash('misma-contraseña-1'));
});

test('verify devuelve false, sin lanzar, con un hash dañado', async () => {
  assert.equal(await fast.verify('esto-no-es-un-hash', 'x'), false);
  assert.equal(await fast.verify('', 'x'), false);
});

test('los parámetros por defecto cumplen el mínimo de OWASP (19 MiB, t=2, p=1)', async () => {
  const hash = await new PasswordHasher().hash('contraseña-de-prueba');
  assert.match(hash, /\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
});

test('los tokens de sesión son largos, únicos y su hash es determinista', () => {
  const a = generateSessionToken();
  const b = generateSessionToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 43); // 32 bytes en base64url
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), a);
  assert.match(hashToken(a), /^[0-9a-f]{64}$/);
});

test('el token CSRF depende de la sesión y no es el token de sesión', () => {
  const a = generateSessionToken();
  const b = generateSessionToken();
  assert.equal(deriveCsrfToken(a), deriveCsrfToken(a));
  assert.notEqual(deriveCsrfToken(a), deriveCsrfToken(b));
  assert.notEqual(deriveCsrfToken(a), a);
  assert.notEqual(deriveCsrfToken(a), hashToken(a));
});

test('safeEqual compara en tiempo constante y tolera longitudes distintas', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
});

test('isOriginAllowed: mismo host con otro puerto sí; otro host no', () => {
  assert.equal(isOriginAllowed(undefined, 'foro1.localhost:4000'), true);
  assert.equal(isOriginAllowed('http://foro1.localhost:3000', 'foro1.localhost:4000'), true);
  assert.equal(isOriginAllowed('http://foro2.localhost:3000', 'foro1.localhost:4000'), false);
  assert.equal(isOriginAllowed('https://evil.com', 'foro1.localhost'), false);
  assert.equal(isOriginAllowed('http://foro1.localhost.evil.com', 'foro1.localhost'), false);
  assert.equal(isOriginAllowed('null', 'foro1.localhost'), false);
  assert.equal(isOriginAllowed('basura', 'foro1.localhost'), false);
  assert.equal(isOriginAllowed('http://foro1.localhost', undefined), false);
});

test('la cookie es HttpOnly, SameSite=Lax y sin Domain; Secure y __Host- en producción', () => {
  const dev = sessionCookieOptions(false, 60);
  const prod = sessionCookieOptions(true, 60);
  for (const options of [dev, prod]) {
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/');
    assert.equal('domain' in options, false);
    assert.equal(options.maxAge, 60_000);
  }
  assert.equal(dev.secure, false);
  assert.equal(prod.secure, true);
  assert.equal(sessionCookieName(true), '__Host-goblins_session');
  assert.equal(sessionCookieName(false), 'goblins_session');
});

test('readCookie encuentra la cookie correcta y tolera basura', () => {
  assert.equal(readCookie('a=1; goblins_session=tok; b=2', 'goblins_session'), 'tok');
  assert.equal(readCookie('xgoblins_session=no', 'goblins_session'), undefined);
  assert.equal(readCookie(undefined, 'goblins_session'), undefined);
  assert.equal(readCookie('goblins_session=%E0%A4%A', 'goblins_session'), undefined);
});
