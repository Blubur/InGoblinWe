import type { Pool } from 'pg';
import { addMembership } from './memberships';
import { withTransaction } from './transaction';

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

export interface NewCommunity {
  slug: string;
  name: string;
  /** Host principal ya normalizado (minúsculas, sin puerto), p. ej. "mi-foro.goblins.example". */
  host: string;
  /** Si se indica, esa cuenta pasa a ser administradora de la comunidad al crearla. */
  adminUserId?: string;
}

export type CreateCommunityResult =
  | { ok: true; community: CommunityRef }
  | { ok: false; reason: 'slug_taken' | 'host_taken' };

/** Señal interna para deshacer la transacción cuando el host ya está registrado. */
class HostTakenSignal extends Error {}

/**
 * Crea la comunidad, su dominio principal y (opcionalmente) la membresía de su
 * administrador, todo en una transacción: no queda una comunidad sin dominio.
 * Un slug o host ya usado no lanza error: se devuelve el motivo.
 */
export async function createCommunity(pool: Pool, input: NewCommunity): Promise<CreateCommunityResult> {
  try {
    return await withTransaction(pool, async (client): Promise<CreateCommunityResult> => {
      const inserted = await client.query<CommunityRef>(
        `INSERT INTO communities (slug, name)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id, slug, name, status`,
        [input.slug, input.name],
      );
      const community = inserted.rows[0];
      if (!community) return { ok: false, reason: 'slug_taken' };

      const domain = await client.query(
        `INSERT INTO community_domains (community_id, host, is_primary)
         VALUES ($1, $2, true)
         ON CONFLICT (host) DO NOTHING`,
        [community.id, input.host],
      );
      if ((domain.rowCount ?? 0) === 0) throw new HostTakenSignal();

      if (input.adminUserId) await addMembership(client, community.id, input.adminUserId, 'admin');
      return { ok: true, community };
    });
  } catch (error) {
    if (error instanceof HostTakenSignal) return { ok: false, reason: 'host_taken' };
    throw error;
  }
}

export interface CommunitySummary extends CommunityRef {
  primaryHost: string | null;
  memberCount: number;
  createdAt: string;
}

interface SummaryRow extends CommunityRef {
  primary_host: string | null;
  member_count: number;
  created_at: Date;
}

export interface ListCommunitiesOptions {
  /** Si se indica, solo las comunidades que administra esa cuenta. */
  adminUserId?: string;
}

/**
 * Comunidades, de la más reciente a la más antigua. Sin opciones devuelve todas
 * (panel del propietario); con adminUserId, solo las que administra esa cuenta.
 */
export async function listCommunities(
  db: Queryable,
  options: ListCommunitiesOptions = {},
): Promise<CommunitySummary[]> {
  const result = await db.query<SummaryRow>(
    `SELECT c.id, c.slug, c.name, c.status, c.created_at,
            (SELECT d.host FROM community_domains d
              WHERE d.community_id = c.id AND d.is_primary) AS primary_host,
            (SELECT count(*)::int FROM memberships m WHERE m.community_id = c.id) AS member_count
       FROM communities c
      WHERE $1::uuid IS NULL
         OR EXISTS (SELECT 1 FROM memberships a
                     WHERE a.community_id = c.id AND a.user_id = $1::uuid AND a.role = 'admin')
      ORDER BY c.created_at DESC, c.slug`,
    [options.adminUserId ?? null],
  );
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    primaryHost: row.primary_host,
    memberCount: row.member_count,
    createdAt: row.created_at.toISOString(),
  }));
}

/** Cambia el estado. Devuelve null si la comunidad no existe. */
export async function setCommunityStatus(
  db: Queryable,
  id: string,
  status: CommunityStatus,
): Promise<CommunityRef | null> {
  const result = await db.query<CommunityRef>(
    `UPDATE communities SET status = $2, updated_at = now()
      WHERE id = $1
      RETURNING id, slug, name, status`,
    [id, status],
  );
  return result.rows[0] ?? null;
}
