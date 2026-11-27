import type { Pool } from 'pg';
import { withTransaction } from './transaction';

type Queryable = Pick<Pool, 'query'>;

const FOREIGN_KEY_VIOLATION = '23503';

function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === FOREIGN_KEY_VIOLATION;
}

/** Señal interna para deshacer la transacción y devolver un motivo en vez de lanzar. */
class Abort extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export interface Topic {
  id: string;
  communityId: string;
  forumId: string;
  authorId: string | null;
  authorName: string | null;
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  replyCount: number;
  lastPostAt: Date;
  createdAt: Date;
}

export interface Post {
  id: string;
  communityId: string;
  topicId: string;
  authorId: string | null;
  authorName: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

const MAX_PAGE = 100;

function page(options: PageOptions | undefined, defaultLimit: number): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(options?.limit ?? defaultLimit), 1), MAX_PAGE);
  const offset = Math.max(Math.trunc(options?.offset ?? 0), 0);
  return { limit, offset };
}

const TOPIC_COLUMNS = `t.id, t.community_id AS "communityId", t.forum_id AS "forumId", t.author_id AS "authorId",
  u.display_name AS "authorName", t.title, t.is_pinned AS "isPinned", t.is_locked AS "isLocked",
  t.reply_count AS "replyCount", t.last_post_at AS "lastPostAt", t.created_at AS "createdAt"`;

const POST_COLUMNS = `p.id, p.community_id AS "communityId", p.topic_id AS "topicId", p.author_id AS "authorId",
  u.display_name AS "authorName", p.body, p.created_at AS "createdAt", p.edited_at AS "editedAt"`;

export type CreateTopicResult =
  | { ok: true; topic: Topic; post: Post }
  | { ok: false; reason: 'forum_not_found' | 'forum_locked' | 'not_a_member' };

/**
 * Crea un tema y su primer mensaje en una transacción. El autor debe ser miembro de la
 * comunidad (si no, not_a_member). En un foro bloqueado no se crean temas.
 */
export async function createTopic(
  pool: Pool,
  communityId: string,
  input: { forumId: string; authorId: string; title: string; body: string },
): Promise<CreateTopicResult> {
  try {
    return await withTransaction(pool, async (client): Promise<CreateTopicResult> => {
      const forum = await client.query<{ isLocked: boolean }>(
        `SELECT is_locked AS "isLocked" FROM forums WHERE community_id = $1 AND id = $2 FOR SHARE`,
        [communityId, input.forumId],
      );
      if (!forum.rows[0]) throw new Abort('forum_not_found');
      if (forum.rows[0].isLocked) throw new Abort('forum_locked');

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO topics (community_id, forum_id, author_id, title)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [communityId, input.forumId, input.authorId, input.title],
      );
      const topicId = inserted.rows[0]!.id;
      const postRow = await client.query<{ id: string }>(
        `INSERT INTO posts (community_id, topic_id, author_id, body)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [communityId, topicId, input.authorId, input.body],
      );
      const topic = await client.query<Topic>(
        `SELECT ${TOPIC_COLUMNS} FROM topics t LEFT JOIN users u ON u.id = t.author_id
          WHERE t.community_id = $1 AND t.id = $2`,
        [communityId, topicId],
      );
      const post = await client.query<Post>(
        `SELECT ${POST_COLUMNS} FROM posts p LEFT JOIN users u ON u.id = p.author_id
          WHERE p.community_id = $1 AND p.id = $2`,
        [communityId, postRow.rows[0]!.id],
      );
      return { ok: true, topic: topic.rows[0]!, post: post.rows[0]! };
    });
  } catch (error) {
    if (error instanceof Abort) return { ok: false, reason: error.reason as 'forum_not_found' | 'forum_locked' };
    // Con el foro ya comprobado, una clave foránea que falla solo puede ser el autor.
    if (isForeignKeyViolation(error)) return { ok: false, reason: 'not_a_member' };
    throw error;
  }
}

export type CreatePostResult =
  | { ok: true; post: Post }
  | { ok: false; reason: 'topic_not_found' | 'topic_locked' | 'forum_locked' | 'not_a_member' };

/**
 * Responde a un tema. Bloquea la fila del tema para que reply_count y last_post_at no se
 * pierdan si dos personas responden a la vez. No admite respuestas en temas o foros bloqueados.
 */
export async function createPost(
  pool: Pool,
  communityId: string,
  input: { topicId: string; authorId: string; body: string },
): Promise<CreatePostResult> {
  try {
    return await withTransaction(pool, async (client): Promise<CreatePostResult> => {
      const topic = await client.query<{ topicLocked: boolean; forumLocked: boolean }>(
        `SELECT t.is_locked AS "topicLocked", f.is_locked AS "forumLocked"
           FROM topics t
           JOIN forums f ON f.community_id = t.community_id AND f.id = t.forum_id
          WHERE t.community_id = $1 AND t.id = $2
          FOR UPDATE OF t`,
        [communityId, input.topicId],
      );
      const row = topic.rows[0];
      if (!row) throw new Abort('topic_not_found');
      if (row.topicLocked) throw new Abort('topic_locked');
      if (row.forumLocked) throw new Abort('forum_locked');

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO posts (community_id, topic_id, author_id, body)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [communityId, input.topicId, input.authorId, input.body],
      );
      await client.query(
        `UPDATE topics SET reply_count = reply_count + 1, last_post_at = now(), updated_at = now()
          WHERE community_id = $1 AND id = $2`,
        [communityId, input.topicId],
      );
      const post = await client.query<Post>(
        `SELECT ${POST_COLUMNS} FROM posts p LEFT JOIN users u ON u.id = p.author_id
          WHERE p.community_id = $1 AND p.id = $2`,
        [communityId, inserted.rows[0]!.id],
      );
      return { ok: true, post: post.rows[0]! };
    });
  } catch (error) {
    if (error instanceof Abort) {
      return { ok: false, reason: error.reason as 'topic_not_found' | 'topic_locked' | 'forum_locked' };
    }
    if (isForeignKeyViolation(error)) return { ok: false, reason: 'not_a_member' };
    throw error;
  }
}

export async function findTopic(db: Queryable, communityId: string, topicId: string): Promise<Topic | null> {
  const result = await db.query<Topic>(
    `SELECT ${TOPIC_COLUMNS} FROM topics t LEFT JOIN users u ON u.id = t.author_id
      WHERE t.community_id = $1 AND t.id = $2`,
    [communityId, topicId],
  );
  return result.rows[0] ?? null;
}

/** Temas de un foro: primero los fijados y luego los de actividad más reciente. */
export async function listTopics(
  db: Queryable,
  communityId: string,
  forumId: string,
  options?: PageOptions,
): Promise<Topic[]> {
  const { limit, offset } = page(options, 30);
  const result = await db.query<Topic>(
    `SELECT ${TOPIC_COLUMNS} FROM topics t LEFT JOIN users u ON u.id = t.author_id
      WHERE t.community_id = $1 AND t.forum_id = $2
      ORDER BY t.is_pinned DESC, t.last_post_at DESC, t.id
      LIMIT $3 OFFSET $4`,
    [communityId, forumId, limit, offset],
  );
  return result.rows;
}

/** Mensajes de un tema en orden de publicación. */
export async function listPosts(
  db: Queryable,
  communityId: string,
  topicId: string,
  options?: PageOptions,
): Promise<Post[]> {
  const { limit, offset } = page(options, 20);
  const result = await db.query<Post>(
    `SELECT ${POST_COLUMNS} FROM posts p LEFT JOIN users u ON u.id = p.author_id
      WHERE p.community_id = $1 AND p.topic_id = $2
      ORDER BY p.seq
      LIMIT $3 OFFSET $4`,
    [communityId, topicId, limit, offset],
  );
  return result.rows;
}
