import type { NextFunction, Request, Response } from 'express';
import type { AuthRequest } from './auth';
import type { AuthService } from './auth.service';
import { isOriginAllowed } from './origin';
import { readCookie } from './session-cookie';
import { safeEqual } from './tokens';

export interface AuthMiddlewareOptions {
  service: Pick<AuthService, 'resolve'>;
  cookieName: string;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function reject(res: Response, message: string): void {
  res.status(403).json({ statusCode: 403, message });
}

/**
 * Identifica a quien hace la petición (req.auth) y protege las peticiones que
 * modifican datos: comprueba Origin siempre y, si hay sesión, el token CSRF.
 * Debe ir después del middleware de tenant, porque la sesión depende de él.
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  return async (request: Request, res: Response, next: NextFunction): Promise<void> => {
    const req = request as AuthRequest;
    try {
      const modifies = !SAFE_METHODS.has(req.method);
      if (modifies && !isOriginAllowed(req.headers.origin, req.headers.host)) {
        return reject(res, 'Origen no permitido');
      }

      const token = readCookie(req.headers.cookie, options.cookieName);
      if (token && req.tenant) {
        const auth = await options.service.resolve(req.tenant, token);
        if (auth) {
          req.auth = auth;
          const sent = req.headers['x-csrf-token'];
          if (modifies && !safeEqual(typeof sent === 'string' ? sent : undefined, auth.csrfToken)) {
            return reject(res, 'Token CSRF no válido');
          }
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
