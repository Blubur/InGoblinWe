# 0002 · Modelo de datos del motor de foros

Estado: aplicado en las migraciones 0006 y 0007 (Fase 3, paso 1).

## Aislamiento entre comunidades en la base de datos

Todas las tablas del foro llevan `community_id`. Las referencias entre ellas usan claves foráneas
**compuestas** (`community_id`, `id`). Un tema no puede apuntar a un foro de otra comunidad, ni un
subforo colgar de una categoría ajena, ni un autor ser alguien que no es miembro de esa comunidad,
aunque el código de la aplicación tuviera un fallo. Además, cada consulta de `packages/database`
recibe `communityId` y lo aplica siempre. Son dos barreras independientes; PostgreSQL RLS sigue
aplazado (ver el resumen de la Fase 1).

## Estructura

- Categorías → foros → subforos (`forums.parent_forum_id`). Un subforo está en la misma categoría
  que su padre (clave compuesta de tres columnas). Un disparador impide ciclos. La profundidad no
  tiene límite en la base de datos; si hace falta, se limita en la API.
- Mover un foro con subforos a otra categoría queda bloqueado por esa misma clave: se hará con una
  operación explícita cuando haga falta, no con un `UPDATE` suelto.
- Un tema tiene siempre un primer mensaje (el de menor `seq`). `reply_count` no cuenta ese primero.
  `reply_count` y `last_post_at` se mantienen en `createPost`, bajo bloqueo de la fila del tema.

## Borrado

- Borrar una categoría con foros, o un foro con subforos o temas, falla a propósito (`not_empty`).
- Borrar un tema borra sus mensajes. Borrar la comunidad lo borra todo.
- Si una membresía o una cuenta desaparece, sus temas y mensajes se conservan con `author_id` nulo
  (la interfaz mostrará "usuario eliminado"). Requiere PostgreSQL 15 o superior
  (`ON DELETE SET NULL (columna)`). Docker usa 17; en Neon comprueba `SELECT version();`.

## Contenido

El texto de los mensajes se guarda tal cual se escribió, sin HTML. Quien lo muestre debe escaparlo o
sanearlo al renderizar (esto entra con el motor de plantillas, Fase 6). Límites: título 200,
mensaje 50.000 caracteres.

## Pendiente de este paso

Sin permisos ni API todavía: editar y borrar mensajes, fijar y bloquear temas, moderación,
suscripciones y búsqueda llegan en los pasos siguientes. Sin ORM: SQL directo con `pg`.

## API (Fase 3, paso 2) y permisos

Rutas bajo `/api/v1`, solo dentro de una comunidad (por host). No hay invitados: todo exige sesión
y ser miembro de esa comunidad. Ni el propietario de la plataforma ni las cuentas del panel central
entran en el foro de una comunidad en la que no son miembros.

| Quién | Qué puede |
|---|---|
| Miembro | Leer categorías, foros, temas y mensajes; crear temas; responder |
| Administrador de la comunidad | Todo lo anterior y crear, editar y borrar categorías y foros (incluido bloquear un foro) |

- `GET|POST /categories`, `PATCH|DELETE /categories/:id`
- `GET|POST /forums`, `PATCH|DELETE /forums/:id`
- `GET|POST /forums/:id/topics`, `GET /topics/:id`, `GET|POST /topics/:id/posts`

La comunidad sale siempre del host (`req.tenant`) y el autor siempre es quien hace la petición: ni
`communityId` ni `authorId` se aceptan del cuerpo. Los permisos se comprueban antes que los datos
(un miembro que envía basura a una ruta de administrador recibe 403, no 400). Un id de otra
comunidad da 404, igual que uno inexistente. Borrar algo con contenido da 409. Foro o tema
bloqueado: 403.

Todavía no hay: editar o borrar mensajes propios, fijar o cerrar temas, gestión de roles de los
miembros, perfil y cuenta, ni moderación.
