/**
 * Normaliza el valor de la cabecera Host: minúsculas, sin puerto y sin punto
 * final. Devuelve null si no tiene forma de host válido, para que nada raro
 * llegue a la base de datos ni se confunda con una comunidad.
 */
export function normalizeHost(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 255) return null;

  let host: string;
  if (value.startsWith('[')) {
    // IPv6 literal: [::1] o [::1]:4000
    const end = value.indexOf(']');
    if (end === -1) return null;
    host = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (rest !== '' && !/^:\d{1,5}$/.test(rest)) return null;
    return /^[0-9a-f:]+$/.test(host) && host.includes(':') ? host : null;
  }

  const colon = value.indexOf(':');
  if (colon !== -1) {
    const port = value.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port)) return null;
    value = value.slice(0, colon);
  }
  host = value.endsWith('.') ? value.slice(0, -1) : value;

  if (host.length === 0 || host.length > 253) return null;
  const labels = host.split('.');
  const validLabel = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  return labels.every((label) => validLabel.test(label)) ? host : null;
}

export type HostKind = 'platform' | 'community';

export interface ClassifyOptions {
  /** Dominio base de la plataforma, por ejemplo "localhost" o "goblins.example". */
  baseDomain: string;
  /** Si es true, 127.0.0.1 y ::1 se tratan como la plataforma (solo desarrollo). */
  allowLoopback: boolean;
}

const LOOPBACK = new Set(['127.0.0.1', '::1']);

/**
 * Decide si un host (ya normalizado) pertenece a la plataforma central o debe
 * buscarse como comunidad. No consulta nada: la existencia de la comunidad la
 * decide la base de datos.
 */
export function classifyHost(host: string, options: ClassifyOptions): HostKind {
  if (host === options.baseDomain.toLowerCase()) return 'platform';
  if (options.allowLoopback && LOOPBACK.has(host)) return 'platform';
  return 'community';
}
