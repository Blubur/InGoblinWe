import type { Pool } from 'pg';

type Queryable = Pick<Pool, 'query'>;

export type UserStatus = 'active' | 'disabled';

export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  isPlatformOwner: boolean;
  status: UserStatus;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  is_platform_owner: boolean;
  status: UserStatus;
}

const COLUMNS = 'id, email, display_name, password_hash, is_platform_owner, status';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    isPlatformOwner: row.is_platform_owner,
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
