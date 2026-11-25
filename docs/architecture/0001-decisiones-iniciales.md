# 0001 · Decisiones técnicas iniciales

Registro de las decisiones tomadas al iniciar el proyecto, con su motivo y lo que las haría cambiar.

## Contexto de uso

Goblins se usa de forma privada, entre el propietario y amigos de confianza, en un entorno controlado. Eso permite aplazar defensas pensadas para plataformas públicas, pero no las decisiones que serían caras de corregir más adelante.

## Decisiones

### Monorepo con pnpm workspaces, sin Turborepo (todavía)
Con dos paquetes y dos aplicaciones, `pnpm -r` ejecuta las tareas en orden topológico. Turborepo añade caché y orquestación que hoy no aportan y es otra pieza que puede fallar. Se añadirá cuando las compilaciones se vuelvan lentas.

### Migraciones SQL propias, sin ORM en la Fase 1
Drizzle, la opción prevista, tiene su línea 1.0 en *release candidate* y la rc.6 (20 de noviembre de 2026) anuncia cambios incompatibles en migraciones. Un ejecutor de SQL de unas 100 líneas elimina esa dependencia, sirve igual para la instalación independiente y permite escribir RLS o extensiones de PostgreSQL a mano. Drizzle u otra capa de consultas se decidirá en la Fase 2, cuando existan las primeras consultas reales y se pueda comprobar su versión estable.

### API NestJS como CommonJS
NestJS 12 publica su núcleo como ESM, pero admite aplicaciones CommonJS mediante `require(esm)` (Node 22.12+). Se mantiene CommonJS porque el resto de dependencias (`pg`, `ioredis`) lo son y evita fricción con decoradores. Migrar a ESM es opcional y se puede hacer más adelante de una sola vez.

### TypeScript fijado en la serie 6
TypeScript 7.0 (8 de julio de 2026) es el compilador nativo y no incluye API de JavaScript; la anuncia para la 7.1. La CLI de Nest 12 (que además pide TypeScript 6 como dependencia par) y Next.js dependen de esa API, así que `scripts/setup.sh` instala `typescript@6`. Cuando exista la API de 7.x y las herramientas la soporten, se reevaluará; la vía intermedia documentada es mantener `typescript` apuntando a `@typescript/typescript6` y usar el compilador 7 solo para `tsc`.

Los valores por defecto de `tsconfig` también cambiaron (`strict`, `module`, `rootDir`, `types`), así que `strict`, `module`, `moduleResolution`, `rootDir` y `types` se declaran de forma explícita.

### Pruebas con el ejecutor integrado de Node (`node:test`)
Sin dependencias adicionales y compatible con los decoradores de Nest (que Vitest y esbuild no soportan por `emitDecoratorMetadata`). Se compila con `tsc` y se ejecuta el resultado.

### Foro público renderizado en el servidor desde la API
El foro público debe renderizar plantillas HTML editables por cada administrador, lo que encaja mal con React. Se renderizará desde NestJS con un motor de plantillas restringido (candidato: LiquidJS). Next.js queda para los paneles y el editor. Se confirmará en la Fase 6.

### Cookies de sesión por host y dominio local `*.localhost`
Cada comunidad tendrá su propia sesión (cookie sin atributo `Domain`). En local los foros serán `nombre.localhost`, que los navegadores resuelven sin tocar el archivo hosts.

### Servicios de datos publicados solo en 127.0.0.1
PostgreSQL y Redis no son accesibles desde la red, y la API escucha en `127.0.0.1` por defecto.

### Versiones de las imágenes
`postgres:17-alpine` y `redis:7-alpine`. PostgreSQL 18 cambió la ruta del volumen de datos, así que se fija 17 de forma deliberada; migrar a 18 requiere cambiar el montaje del volumen. Las dependencias de Node se resuelven a la última versión estable en la instalación y quedan fijadas en `pnpm-lock.yaml`.

## Aplazado deliberadamente (uso privado)

Se añadirán si cambia el contexto de uso: dominio aparte y sandbox estricto para el JavaScript de usuario, RLS de PostgreSQL, análisis de recursos de la biblioteca, límites de uso y rate limiting estricto.

## Se mantiene desde el principio

`community_id` en todas las tablas de una comunidad, Argon2id, consultas parametrizadas, cookies host-only y un motor de plantillas sin acceso al servidor (una plantilla con un bucle infinito tumbaría todos los foros, sin necesidad de mala fe).
