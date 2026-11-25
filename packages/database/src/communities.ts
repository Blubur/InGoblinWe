import type { Pool } from 'pg';

export type CommunityStatus = 'active' | 'suspended';

export interface CommunityRef {
  id: string;
  slug: string;
  name: string;
  status: CommunityStatus;
}

/** Solo necesita poder consultar, así que acepta un pool o un cliente. */
type Queryable = Pick<Pool, 'query'>;

/**
 * Busca la comunidad a la que pertenece un host exacto (ya normalizado, en
 * minúsculas). Devuelve null si ningún dominio registrado coincide.
 */
export async function findCommunityByHost(db: Queryable, host: string): Promise<CommunityRef | null> {
  const result = await db.query<CommunityRef>(
    `SELECT c.id, c.slug, c.name, c.status
       FROM community_domains d
       JOIN communities c ON c.id = d.community_id
      WHERE d.host = $1`,
    [host],
  );
  return result.rows[0] ?? null;
}
