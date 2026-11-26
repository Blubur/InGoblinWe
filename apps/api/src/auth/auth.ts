import type { TenantRequest } from '../tenant/tenant';

/**
 * owner: propietario de la plataforma. user: cuenta en el panel central.
 * admin y member: rol dentro de una comunidad.
 */
export type AuthRole = 'owner' | 'user' | 'admin' | 'member';

/** Quién es la persona que hace la petición, ya verificado contra la comunidad actual. */
export interface AuthContext {
  userId: string;
  email: string;
  displayName: string;
  role: AuthRole;
  /**
   * Puede crear comunidades: el propietario siempre; el resto, si el propietario
   * se lo ha activado. Solo tiene sentido en el panel central.
   */
  canCreateCommunities: boolean;
  /** Token que el cliente debe devolver en X-CSRF-Token al modificar datos. */
  csrfToken: string;
}

export type AuthRequest = TenantRequest & { auth?: AuthContext };
