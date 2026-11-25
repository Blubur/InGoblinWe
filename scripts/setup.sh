#!/usr/bin/env bash
# Instala las dependencias con las versiones estables actuales (pnpm las fija en
# pnpm-lock.yaml), compila los paquetes compartidos y prepara el archivo .env.
# Uso, desde la raíz del repositorio:  bash scripts/setup.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> Comprobando herramientas"
node -v
pnpm -v
node -e "const [a,b]=process.versions.node.split('.').map(Number); if (a<22 || (a===22 && b<12)) { console.error('Se necesita Node >= 22.12'); process.exit(1); }"

# TypeScript se fija en la serie 6 a propósito: la 7.0 no incluye API de JavaScript
# y la CLI de Nest y Next.js la necesitan. Ver docs/architecture/0001-decisiones-iniciales.md.

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Creado .env a partir de .env.example"
fi

echo "==> @goblins/core"
pnpm --filter @goblins/core add zod
pnpm --filter @goblins/core add -D typescript@6 @types/node

echo "==> @goblins/database"
pnpm --filter @goblins/database add pg
pnpm --filter @goblins/database add -D typescript@6 @types/node @types/pg

echo "==> @goblins/api"
pnpm --filter @goblins/api add @nestjs/common @nestjs/core @nestjs/platform-express reflect-metadata rxjs ioredis
pnpm --filter @goblins/api add -D @nestjs/cli typescript@6 @types/node @types/express

echo "==> @goblins/web"
pnpm --filter @goblins/web add next react react-dom
pnpm --filter @goblins/web add -D typescript@6 @types/node @types/react @types/react-dom

echo "==> Compilando paquetes compartidos"
pnpm run build:packages

echo
echo "==> Versiones instaladas (cópialas si algo falla)"
pnpm -r list --depth 0

echo
echo "Listo. Siguientes pasos:"
echo "  1. pnpm docker:up     (PostgreSQL y Redis; necesita Docker Desktop)"
echo "  2. pnpm db:migrate"
echo "  3. pnpm test"
echo "  4. pnpm dev"
