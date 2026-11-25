# Goblins

Plataforma para crear y administrar múltiples foros y comunidades con personalización avanzada. Uso privado e inicialmente gratuito.

**Estado: Fase 1 (infraestructura). Código escrito, pendiente de verificar en local.** Consulta [los criterios de cierre](#criterios-de-cierre-de-la-fase-1) antes de darla por terminada.

## Requisitos

- Node.js 22.12 o superior (probado el diseño con Node 24)
- pnpm
- Docker Desktop (con WSL2 en Windows) para PostgreSQL y Redis
- Git Bash o cualquier shell tipo bash

## Arranque desde cero

```bash
# 1. Instala dependencias, crea .env y compila los paquetes compartidos
bash scripts/setup.sh

# 2. Levanta PostgreSQL y Redis (espera a que estén sanos)
pnpm docker:up

# 3. Aplica las migraciones
pnpm db:migrate

# 4. Ejecuta las pruebas
pnpm test

# 5. Arranca API y web en modo desarrollo
pnpm dev
```

Comprueba que funciona:

| Qué | Dirección | Esperado |
|---|---|---|
| Liveness de la API | http://127.0.0.1:4000/api/v1/health | `{"status":"ok",...}` |
| Readiness (PostgreSQL + Redis) | http://127.0.0.1:4000/api/v1/health/ready | `status: "ok"` con latencias |
| Web | http://localhost:3000 | Cuatro servicios en verde |

Si paras Docker (`pnpm docker:down`), `/health/ready` debe devolver HTTP 503 señalando qué servicio cayó, y la web debe mostrarlo en rojo.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Compila los paquetes y arranca API (puerto 4000) y web (puerto 3000) |
| `pnpm test` | Compila los paquetes y ejecuta todas las pruebas |
| `pnpm build` | Compila todo (paquetes, API y web) |
| `pnpm build:packages` | Recompila `core` y `database`. Hazlo si cambias algo en `packages/` |
| `pnpm docker:up` / `docker:down` | Levanta / detiene PostgreSQL y Redis |
| `pnpm db:migrate` | Aplica las migraciones pendientes |

Para borrar los datos locales y empezar de cero: `docker compose down -v`.

## Estructura

```text
goblins/
├── apps/
│   ├── api/        API NestJS (REST, prefijo /api/v1)
│   └── web/        Next.js (paneles; hoy solo la página de estado)
├── packages/
│   ├── core/       Configuración validada (zod) y utilidades
│   └── database/   Pool de PostgreSQL y migraciones SQL
├── docs/
│   └── architecture/   Decisiones técnicas
├── scripts/setup.sh
└── docker-compose.yml
```

Los demás paquetes del documento maestro (`template-engine`, `forum-engine`, etc.) se crearán cuando su fase lo requiera.

## Migraciones

Son archivos SQL en `packages/database/migrations/` con el formato `NNNN_descripcion.sql`. El ejecutor las aplica en orden, cada una en su transacción, y guarda un checksum en la tabla `schema_migrations`. **Una migración ya aplicada no se edita**: si su contenido cambia, el ejecutor aborta. Para cambiar el esquema, crea una nueva.

## Configuración

Todo se configura con variables de entorno, validadas al arrancar (`packages/core/src/env.ts`). Parte de `.env.example`. Si falta algo o es inválido, la API se detiene con un mensaje que nombra la variable.

## Solución de problemas

- **`pnpm` avisa de "Ignored build scripts"**: es una medida de seguridad de pnpm y aquí no afecta al funcionamiento.
- **El puerto 5432 o 6379 ya está en uso**: cambia `POSTGRES_PORT` / `REDIS_PORT` en `.env` y ajusta `DATABASE_URL` / `REDIS_URL` al mismo puerto.
- **`docker` no se reconoce**: instala Docker Desktop y reabre la terminal.
- **Error de `require(esm)` al arrancar la API**: NestJS 12 publica su núcleo como ESM y esta API se ejecuta como CommonJS apoyándose en `require(esm)`, que exige Node 22.12+ (o 20.19+). Comprueba `node -v`.
- **`nest` se queja de la versión de Node**: la CLI de Nest 12 pide Node 22.22.3+ o 24.15+ para `new`, `generate` y `upgrade`. Aquí solo se usan `build` y `start`, pero si ves ese aviso, actualiza Node.

## Criterios de cierre de la Fase 1

La fase está terminada cuando, en una máquina limpia, se cumple todo esto:

- [ ] `bash scripts/setup.sh` termina sin errores
- [ ] `pnpm docker:up` deja PostgreSQL y Redis en estado *healthy*
- [ ] `pnpm db:migrate` aplica `0001_communities.sql`, y una segunda ejecución la omite
- [ ] `pnpm test` pasa completo
- [ ] `pnpm dev` arranca API y web
- [ ] `/api/v1/health/ready` devuelve 200 con Docker arriba y 503 con Docker parado
- [ ] La web muestra el estado real de los cuatro servicios
- [ ] Se hace el primer commit con `pnpm-lock.yaml` incluido

## Siguiente fase

Fase 2: identidad, comunidades y aislamiento multi-comunidad (resolución de subdominios `*.localhost`, sesiones con cookies por host, `community_id` en todo).
