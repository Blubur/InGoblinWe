import type { TenantRequest } from '../tenant/tenant';

export type AuthRole = 'owner' | 'admin' | 'member';

/** Quién es la persona que hace la petición, ya verificado contra la comunidad actual. */
export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  role: AuthRole;
  /** Token que el cliente debe devolver en X-CSRF-Token al modificar datos. */
  csrfToken: string;
}

export type AuthRequest = TenantRequest & { auth?: AuthContext };
