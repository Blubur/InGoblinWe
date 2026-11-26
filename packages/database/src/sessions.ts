import type { Pool } from 'pg';

type Queryable = Pick<Pool, 'query'>;

export interface ActiveSession {
  userId: string;
  /** null = sesión del panel central. */
  communityId: string | null;
}

export interface NewSession {
  tokenHash: string;
  userId: string;
  communityId: string | null;
  ttlSeconds: number;
}

export async function createSession(db: Queryable, input: NewSession): Promise<void> {
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, community_id, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
    [input.tokenHash, input.userId, input.communityId, input.ttlSeconds],
  );
}

/** Devuelve la sesión solo si no ha caducado y el usuario sigue activo. */
export async function findActiveSession(db: Queryable, tokenHash: string): Promise<ActiveSession | null> {
  const result = await db.query<{ user_id: string; community_id: string | null }>(
    `SELECT s.user_id, s.community_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
    [tokenHash],
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, communityId: row.community_id } : null;
}

export async function deleteSession(db: Queryable, tokenHash: string): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

export async function deleteExpiredSessions(db: Queryable): Promise<number> {
  const result = await db.query(`DELETE FROM sessions WHERE expires_at <= now()`);
  return result.rowCount ?? 0;
}
