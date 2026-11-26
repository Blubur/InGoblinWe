import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, parseConfig, parseDatabaseUrl } from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  REDIS_URL: 'redis://127.0.0.1:6379',
};

test('aplica los valores por defecto', () => {
  const config = parseConfig(valid);
  assert.equal(config.API_PORT, 4000);
  assert.equal(config.API_HOST, '127.0.0.1');
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.PLATFORM_BASE_DOMAIN, 'localhost');
});

test('convierte API_PORT a número', () => {
  assert.equal(parseConfig({ ...valid, API_PORT: '5000' }).API_PORT, 5000);
});

test('falla si falta DATABASE_URL y nombra la variable', () => {
  assert.throws(
    () => parseConfig({ REDIS_URL: valid.REDIS_URL }),
    (error: unknown) => error instanceof ConfigError && error.message.includes('DATABASE_URL'),
  );
});

test('rechaza un puerto fuera de rango', () => {
  assert.throws(() => parseConfig({ ...valid, API_PORT: '70000' }), ConfigError);
});

test('rechaza un NODE_ENV desconocido', () => {
  assert.throws(() => parseConfig({ ...valid, NODE_ENV: 'staging' }), ConfigError);
});

test('parseDatabaseUrl solo exige DATABASE_URL', () => {
  assert.equal(parseDatabaseUrl({ DATABASE_URL: valid.DATABASE_URL }), valid.DATABASE_URL);
  assert.throws(() => parseDatabaseUrl({}), ConfigError);
});

test('SESSION_TTL_HOURS tiene un valor por defecto y rechaza valores absurdos', () => {
  const base = { DATABASE_URL: 'postgresql://x', REDIS_URL: 'redis://x' };
  assert.equal(parseConfig(base).SESSION_TTL_HOURS, 168);
  assert.equal(parseConfig({ ...base, SESSION_TTL_HOURS: '24' }).SESSION_TTL_HOURS, 24);
  assert.throws(() => parseConfig({ ...base, SESSION_TTL_HOURS: '0' }), /SESSION_TTL_HOURS/);
});
