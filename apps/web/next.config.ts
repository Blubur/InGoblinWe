import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { NextConfig } from 'next';

// En local la web comparte el .env de la raíz del repositorio, pero solo toma
// las variables que necesita: no hace falta que vea DATABASE_URL ni REDIS_URL.
// Las variables ya definidas (por ejemplo, las de Vercel) tienen prioridad.
const WEB_VARIABLES = ['API_URL', 'PROXY_SHARED_SECRET'];
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  const values = parseEnv(readFileSync(rootEnv, 'utf8'));
  for (const name of WEB_VARIABLES) {
    const value = values[name];
    if (process.env[name] === undefined && value) process.env[name] = value;
  }
}

const config: NextConfig = {
  reactStrictMode: true,
};

export default config;
