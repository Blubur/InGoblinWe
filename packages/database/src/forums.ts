import type { Pool } from 'pg';

type Queryable = Pick<Pool, 'query'>;

const FOREIGN_KEY_VIOLATION = '23503';

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === FOREIGN_KEY_VIOLATION;
}

/**
 * Todas las funciones reciben communityId y lo usan en cada consulta: un id de otra
 * comunidad nunca encuentra nada, aunque el id exista. Las claves foráneas compuestas
 * de las migraciones 0006 y 0007 son la segunda barrera.
 */

export interface Category {
  id: string;
  communityId: string;
  name: string;
  position: number;
  createdAt: Date;
}

export interface Forum {
  id: string;
  communityId: string;
  categoryId: string;
  parentForumId: string | null;
  name: string;
  description: string;
  position: number;
  isLocked: boolean;
  topicCount: number;
  createdAt: Date;
}

const CATEGORY_COLUMNS = `id, community_id AS "communityId", name, position, created_at AS "createdAt"`;

const FORUM_COLUMNS = `f.id, f.community_id AS "communityId", f.category_id AS "categoryId",
  f.parent_forum_id AS "parentForumId", f.name, f.description, f.position,
  f.is_locked AS "isLocked", f.created_at AS "createdAt",
  (SELECT count(*)::int FROM topics t WHERE t.community_id = f.community_id AND t.forum_id = f.id) AS "topicCount"`;

export async function createCategory(
  db: Queryable,
  communityId: string,
  input: { name: string; position?: number },
): Promise<Category> {
  const result = await db.query<Category>(
    `INSERT INTO categories (community_id, name, position)
     VALUES ($1, $2, $3)
     RETURNING ${CATEGORY_COLUMNS}`,
    [communityId, input.name, input.position ?? 0],
  );
  return result.rows[0]!;
}

export async function listCategories(db: Queryable, communityId: string): Promise<Category[]> {
  const result = await db.query<Category>(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE community_id = $1 ORDER BY position, name, id`,
    [communityId],
  );
  return result.rows;
}

/** Cambia nombre y/o posición. Devuelve null si la categoría no existe en esa comunidad. */
export async function updateCategory(
  db: Queryable,
  communityId: string,
  categoryId: string,
  changes: { name?: string; position?: number },
): Promise<Category | null> {
  const result = await db.query<Category>(
    `UPDATE categories
        SET name = COALESCE($3, name), position = COALESCE($4, position), updated_at = now()
      WHERE community_id = $1 AND id = $2
      RETURNING ${CATEGORY_COLUMNS}`,
    [communityId, categoryId, changes.name ?? null, changes.position ?? null],
  );
  return result.rows[0] ?? null;
}

export type DeleteResult = 'deleted' | 'not_found' | 'not_empty';

export async function deleteCategory(db: Queryable, communityId: string, categoryId: string): Promise<DeleteResult> {
  try {
    const result = await db.query(`DELETE FROM categories WHERE community_id = $1 AND id = $2`, [
      communityId,
      categoryId,
    ]);
    return (result.rowCount ?? 0) > 0 ? 'deleted' : 'not_found';
  } catch (error) {
    if (isForeignKeyViolation(error)) return 'not_empty';
    throw error;
  }
}

export type CreateForumResult = { ok: true; forum: Forum } | { ok: false; reason: 'invalid_reference' };

/**
 * Crea un foro, o un subforo si se indica parentForumId. La categoría debe ser de la
 * comunidad y el foro padre debe estar en la misma comunidad y categoría; si no,
 * devuelve invalid_reference.
 */
export async function createForum(
  db: Queryable,
  communityId: string,
  input: { categoryId: string; parentForumId?: string; name: string; description?: string; position?: number },
): Promise<CreateForumResult> {
  try {
    const result = await db.query<Forum>(
      `WITH inserted AS (
         INSERT INTO forums (community_id, category_id, parent_forum_id, name, description, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *
       )
       SELECT ${FORUM_COLUMNS} FROM inserted f`,
      [
        communityId,
        input.categoryId,
        input.parentForumId ?? null,
        input.name,
        input.description ?? '',
        input.position ?? 0,
      ],
    );
    return { ok: true, forum: result.rows[0]! };
  } catch (error) {
    if (isForeignKeyViolation(error)) return { ok: false, reason: 'invalid_reference' };
    throw error;
  }
}

/** Todos los foros y subforos de la comunidad, en orden de categoría y posición. */
export async function listForums(db: Queryable, communityId: string): Promise<Forum[]> {
  const result = await db.query<Forum>(
    `SELECT ${FORUM_COLUMNS}
       FROM forums f
       JOIN categories c ON c.community_id = f.community_id AND c.id = f.category_id
      WHERE f.community_id = $1
      ORDER BY c.position, c.name, c.id, f.position, f.name, f.id`,
    [communityId],
  );
  return result.rows;
}

export async function findForum(db: Queryable, communityId: string, forumId: string): Promise<Forum | null> {
  const result = await db.query<Forum>(
    `SELECT ${FORUM_COLUMNS} FROM forums f WHERE f.community_id = $1 AND f.id = $2`,
    [communityId, forumId],
  );
  return result.rows[0] ?? null;
}

/** Cambia nombre, descripción, posición y/o bloqueo. Devuelve null si el foro no existe en esa comunidad. */
export async function updateForum(
  db: Queryable,
  communityId: string,
  forumId: string,
  changes: { name?: string; description?: string; position?: number; isLocked?: boolean },
): Promise<Forum | null> {
  const result = await db.query<Forum>(
    `WITH updated AS (
       UPDATE forums
          SET name = COALESCE($3, name),
              description = COALESCE($4, description),
              position = COALESCE($5, position),
              is_locked = COALESCE($6, is_locked),
              updated_at = now()
        WHERE community_id = $1 AND id = $2
        RETURNING *
     )
     SELECT ${FORUM_COLUMNS} FROM updated f`,
    [
      communityId,
      forumId,
      changes.name ?? null,
      changes.description ?? null,
      changes.position ?? null,
      changes.isLocked ?? null,
    ],
  );
  return result.rows[0] ?? null;
}

/** No borra un foro con subforos ni con temas: devuelve not_empty. */
export async function deleteForum(db: Queryable, communityId: string, forumId: string): Promise<DeleteResult> {
  try {
    const result = await db.query(`DELETE FROM forums WHERE community_id = $1 AND id = $2`, [communityId, forumId]);
    return (result.rowCount ?? 0) > 0 ? 'deleted' : 'not_found';
  } catch (error) {
    if (isForeignKeyViolation(error)) return 'not_empty';
    throw error;
  }
}
