import { normalizeHost } from '@goblins/core';

/**
 * Comprueba la cabecera Origin de una petición que modifica datos. Si el
 * navegador envía Origin, su host debe ser el mismo al que se dirige la
 * petición. Se compara solo el nombre de host (sin puerto): las cookies son por
 * host, y en desarrollo la web (3000) y la API (4000) comparten host.
 *
 * Si no hay Origin (curl, otros servidores) no se rechaza aquí: esas peticiones
 * no llevan cookies de un navegador ajeno, y las autenticadas exigen además el
 * token CSRF.
 */
export function isOriginAllowed(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (origin === undefined) return true;
  let originHost: string | null;
  try {
    originHost = normalizeHost(new URL(origin).host);
  } catch {
    return false;
  }
  const requestHost = normalizeHost(hostHeader);
  return originHost !== null && requestHost !== null && originHost === requestHost;
}
