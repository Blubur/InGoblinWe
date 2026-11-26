import type { IncomingHttpHeaders } from 'node:http';
import { safeEqual } from '../auth/tokens';

/** Host original que ve el navegador, reenviado por el proxy de la web. */
export const FORWARDED_HOST_HEADER = 'x-goblins-host';
/** Prueba de que quien reenvía es el proxy de la web y no un cliente cualquiera. */
export const PROXY_SECRET_HEADER = 'x-goblins-proxy-secret';

export type EffectiveHost =
  | { ok: true; host: string | undefined }
  | { ok: false; message: string };

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Decide a qué host iba dirigida la petición.
 *
 * - Sin secreto configurado: se usa siempre la cabecera Host y se ignora
 *   cualquier host reenviado (comportamiento seguro por defecto).
 * - Con secreto configurado: si llega un host reenviado, solo se acepta si el
 *   secreto coincide; si no coincide se rechaza la petición, no se ignora, para
 *   que un intento de suplantar el host no pase por una petición normal.
 */
export function resolveEffectiveHost(headers: IncomingHttpHeaders, secret: string | undefined): EffectiveHost {
  const hostHeader = single(headers.host);
  if (!secret) return { ok: true, host: hostHeader };

  const forwarded = single(headers[FORWARDED_HOST_HEADER]);
  if (forwarded === undefined) return { ok: true, host: hostHeader };

  if (!safeEqual(single(headers[PROXY_SECRET_HEADER]), secret)) {
    return { ok: false, message: 'Proxy no autorizado' };
  }
  return { ok: true, host: forwarded };
}
