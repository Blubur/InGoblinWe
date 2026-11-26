import type { Request } from 'express';
import type { CommunityRef } from '@goblins/database';

/** Contexto de la petición: de qué parte de Goblins se está hablando. */
export type Tenant =
  | { kind: 'platform' }
  | { kind: 'community'; community: CommunityRef };

/**
 * Petición de Express con el contexto ya resuelto por el middleware de tenant.
 * effectiveHost es el host al que iba dirigida de verdad la petición: la
 * cabecera Host, o el host original que reenvía el proxy de la web si presentó
 * el secreto compartido.
 */
export type TenantRequest = Request & { tenant?: Tenant; effectiveHost?: string };
