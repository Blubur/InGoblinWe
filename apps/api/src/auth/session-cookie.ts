import type { CookieOptions } from 'express';

/**
 * En producción se usa el prefijo __Host-: el navegador solo la acepta si es
 * Secure, de ruta "/" y sin atributo Domain, es decir, atada a un único host.
 */
export function sessionCookieName(production: boolean): string {
  return production ? '__Host-goblins_session' : 'goblins_session';
}

/** Sin atributo Domain a propósito: cada foro tiene su propia cookie. */
export function sessionCookieOptions(production: boolean, maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
  };
}

/** Lee una cookie de la cabecera Cookie sin depender de ningún paquete. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
