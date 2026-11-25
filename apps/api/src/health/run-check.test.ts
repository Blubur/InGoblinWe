import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCheck } from './run-check';

test('una sonda que responde da ok', async () => {
  const result = await runCheck(async () => 'bien');
  assert.equal(result.ok, true);
  assert.equal(result.error, undefined);
});

test('una sonda que falla da error con el mensaje', async () => {
  const result = await runCheck(async () => {
    throw new Error('conexión rechazada');
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'conexión rechazada');
});

test('una sonda que no responde se corta por tiempo', async () => {
  const result = await runCheck(() => new Promise(() => undefined), 20);
  assert.equal(result.ok, false);
  assert.match(result.error ?? '', /sin respuesta/);
});

test('una sonda que lanza de forma síncrona también se captura', async () => {
  const result = await runCheck(() => {
    throw new Error('fallo inmediato');
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'fallo inmediato');
});
