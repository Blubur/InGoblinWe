import type { Pool } from 'pg';

type Queryable = Pick<Pool, 'query'>;

export type MembershipRole = 'admin' | 'member';

export async function findMembershipRole(
  db: Queryable,
  communityId: string,
  userId: string,
): Promise<MembershipRole | null> {
  const result = await db.query<{ role: MembershipRole }>(
    `SELECT role FROM memberships WHERE community_id = $1 AND user_id = $2`,
    [communityId, userId],
  );
  return result.rows[0]?.role ?? null;
}

/** Añade la membresía. Devuelve false si el usuario ya pertenecía a la comunidad. */
export async function addMembership(
  db: Queryable,
  communityId: string,
  userId: string,
  role: MembershipRole = 'member',
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO memberships (community_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (community_id, user_id) DO NOTHING`,
    [communityId, userId, role],
  );
  return (result.rowCount ?? 0) > 0;
}
