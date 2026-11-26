import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token de sesión: 256 bits aleatorios. Solo viaja en la cookie; en la base de datos va su hash. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Token CSRF derivado del token de sesión. Está atado a la sesión, no hace
 * falta guardarlo y un sitio ajeno no puede calcularlo sin conocer la cookie.
 */
export function deriveCsrfToken(sessionToken: string): string {
  return createHash('sha256').update(`goblins-csrf:${sessionToken}`).digest('hex');
}

/** Comparación en tiempo constante. */
export function safeEqual(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
