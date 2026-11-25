import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Pool } from '@goblins/database';
import { HealthController } from './health.controller';

const poolOk = { query: async () => ({ rows: [] }) } as unknown as Pool;
const poolDown = {
  query: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
  },
} as unknown as Pool;
const redisOk = { ping: async () => 'PONG' } as unknown as Redis;
const redisDown = {
  ping: async () => {
    throw new Error('Connection is closed.');
  },
} as unknown as Redis;

test('live responde ok sin tocar servicios externos', () => {
  const result = new HealthController(poolDown, redisDown).live();
  assert.equal(result.status, 'ok');
});

test('ready responde ok cuando PostgreSQL y Redis responden', async () => {
  const result = await new HealthController(poolOk, redisOk).ready();
  assert.equal(result.status, 'ok');
  assert.equal(result.checks.database.ok, true);
  assert.equal(result.checks.redis.ok, true);
});

test('ready lanza 503 si cae PostgreSQL y señala cuál', async () => {
  await assert.rejects(new HealthController(poolDown, redisOk).ready(), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    assert.equal(error.getStatus(), 503);
    const body = error.getResponse() as {
      checks: { database: { ok: boolean }; redis: { ok: boolean } };
    };
    assert.equal(body.checks.database.ok, false);
    assert.equal(body.checks.redis.ok, true);
    return true;
  });
});

test('ready lanza 503 si cae Redis y señala cuál', async () => {
  await assert.rejects(new HealthController(poolOk, redisDown).ready(), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException);
    const body = error.getResponse() as {
      checks: { database: { ok: boolean }; redis: { ok: boolean } };
    };
    assert.equal(body.checks.database.ok, true);
    assert.equal(body.checks.redis.ok, false);
    return true;
  });
});

test('ready lanza 503 si Redis responde algo que no es PONG', async () => {
  const redisOdd = { ping: async () => 'LOQUESEA' } as unknown as Redis;
  await assert.rejects(new HealthController(poolOk, redisOdd).ready(), ServiceUnavailableException);
});
