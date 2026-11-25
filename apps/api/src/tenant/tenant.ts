import type { Request } from 'express';
import type { CommunityRef } from '@goblins/database';

/** Contexto de la petición: de qué parte de Goblins se está hablando. */
export type Tenant =
  | { kind: 'platform' }
  | { kind: 'community'; community: CommunityRef };

/** Petición de Express con el contexto ya resuelto por el middleware de tenant. */
export type TenantRequest = Request & { tenant?: Tenant };
