import * as fs from 'node:fs';
import * as path from 'node:path';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

/** Sube por los directorios hasta encontrar la raíz del monorepo. */
export function findWorkspaceRoot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, WORKSPACE_MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Carga el .env de la raíz del monorepo. Las variables que ya existan en el
 * entorno no se sobrescriben (así Docker o CI siempre mandan sobre el archivo).
 * Devuelve la ruta cargada, o null si no hay raíz o no existe .env.
 */
export function loadRootEnv(startDir: string = process.cwd()): string | null {
  const root = findWorkspaceRoot(startDir);
  if (!root) return null;
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}
