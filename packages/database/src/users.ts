import type { Pool } from 'pg';

type Queryable = Pick<Pool, 'query'>;

export type UserStatus = 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  isPlatformOwner: boolean;
  canCreateCommunities: boolean;
  status: UserStatus;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  is_platform_owner: boolean;
  can_create_communities: boolean;
  status: UserStatus;
}

const COLUMNS = 'id, email, display_name, password_hash, is_platform_owner, can_create_communities, status';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    isPlatformOwner: row.is_platform_owner,
    canCreateCommunities: row.can_create_communities,
    status: row.status,
  };
}

export interface NewUser {
  email: string;
  displayName: string;
  passwordHash: string;
  isPlatformOwner?: boolean;
}

/** Crea el usuario. Devuelve null si el email ya existe (sin lanzar error). */
export async function createUser(db: Queryable, input: NewUser): Promise<User | null> {
  const result = await db.query<UserRow>(
    `INSERT INTO users (email, display_name, password_hash, is_platform_owner)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING
     RETURNING ${COLUMNS}`,
    [input.email, input.displayName, input.passwordHash, input.isPlatformOwner ?? false],
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function findUserByEmail(db: Queryable, email: string): Promise<User | null> {
  const result = await db.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE email = $1`, [email]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

/** Solo devuelve usuarios activos: una cuenta desactivada deja de existir a efectos de sesión. */
export async function findActiveUserById(db: Queryable, id: string): Promise<User | null> {
  const result = await db.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE id = $1 AND status = 'active'`,
    [id],
  );
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

/** Cuenta tal como la ve el propietario en su panel: sin el hash de la contraseña. */
export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  isPlatformOwner: boolean;
  canCreateCommunities: boolean;
  status: UserStatus;
  createdAt: string;
  /** Comunidades que administra. */
  adminOf: number;
}

interface UserSummaryRow {
  id: string;
  email: string;
  display_name: string;
  is_platform_owner: boolean;
  can_create_communities: boolean;
  status: UserStatus;
  created_at: Date;
  admin_of: number;
}

/** Todas las cuentas, las más recientes primero. */
export async function listUsers(db: Queryable): Promise<UserSummary[]> {
  const result = await db.query<UserSummaryRow>(
    `SELECT u.id, u.email, u.display_name, u.is_platform_owner, u.can_create_communities,
            u.status, u.created_at,
            (SELECT count(*)::int FROM memberships m
              WHERE m.user_id = u.id AND m.role = 'admin') AS admin_of
       FROM users u
      ORDER BY u.created_at DESC, u.email`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isPlatformOwner: row.is_platform_owner,
    canCreateCommunities: row.can_create_communities,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    adminOf: row.admin_of,
  }));
}

/** Activa o desactiva el permiso de crear comunidades. Devuelve false si la cuenta no existe. */
export async function setCanCreateCommunities(db: Queryable, id: string, enabled: boolean): Promise<boolean> {
  const result = await db.query(
    `UPDATE users SET can_create_communities = $2, updated_at = now() WHERE id = $1`,
    [id, enabled],
  );
  return (result.rowCount ?? 0) > 0;
}
