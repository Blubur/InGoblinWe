import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findWorkspaceRoot, loadRootEnv } from './workspace';

function makeWorkspace(): { root: string; nested: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goblins-ws-'));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  const nested = path.join(root, 'apps', 'api', 'src');
  fs.mkdirSync(nested, { recursive: true });
  return { root, nested };
}

test('encuentra la raíz subiendo por los directorios', () => {
  const { root, nested } = makeWorkspace();
  try {
    assert.equal(findWorkspaceRoot(nested), path.resolve(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loadRootEnv carga el .env sin pisar variables existentes', () => {
  const { root, nested } = makeWorkspace();
  const keep = 'GOBLINS_TEST_KEEP';
  const fresh = 'GOBLINS_TEST_FRESH';
  try {
    fs.writeFileSync(path.join(root, '.env'), `${fresh}=desde-env\n${keep}=desde-env\n`);
    process.env[keep] = 'ya-definida';
    delete process.env[fresh];

    assert.equal(loadRootEnv(nested), path.join(path.resolve(root), '.env'));
    assert.equal(process.env[fresh], 'desde-env');
    assert.equal(process.env[keep], 'ya-definida');
  } finally {
    delete process.env[keep];
    delete process.env[fresh];
    fs.rmSync(root, { recursive: true, force: true });
  }
});
