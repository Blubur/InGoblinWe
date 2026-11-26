import type { NextFunction, Request, Response } from 'express';
import { classifyHost, normalizeHost } from '@goblins/core';
import { findCommunityByHost, type CommunityRef } from '@goblins/database';
import { resolveEffectiveHost } from './forwarded-host';
import type { Tenant, TenantRequest } from './tenant';

export interface TenantMiddlewareOptions {
  /** Consulta de comunidad por host. En producción, findCommunityByHost sobre el pool. */
  lookup: (host: string) => Promise<CommunityRef | null>;
  baseDomain: string;
  allowLoopback: boolean;
  /** Rutas que no dependen del host (sondas de salud). */
  skipPathPrefixes?: string[];
  /**
   * Secreto compartido con el proxy de la web. Si se define, la API acepta el
   * host original que reenvía ese proxy; si no, solo usa la cabecera Host.
   */
  proxySecret?: string;
}

function reject(res: Response, statusCode: number, message: string): void {
  res.status(statusCode).json({ statusCode, message });
}

/**
 * Resuelve a qué comunidad (o a la plataforma central) va dirigida cada
 * petición a partir de la cabecera Host, y lo deja en req.tenant. Todo lo que
 * venga después puede fiarse de req.tenant y no debe volver a leer el Host.
 *
 * Nota: no se usa X-Forwarded-Host. El único host reenviado que se acepta es el
 * del proxy de la web, y solo si presenta el secreto compartido (proxySecret).
 */
export function createTenantMiddleware(options: TenantMiddlewareOptions) {
  const skip = options.skipPathPrefixes ?? [];

  return async (request: Request, res: Response, next: NextFunction): Promise<void> => {
    const req = request as TenantRequest;
    try {
      if (skip.some((prefix) => req.path.startsWith(prefix))) {
        req.tenant = { kind: 'platform' } satisfies Tenant;
        return next();
      }

      const effective = resolveEffectiveHost(req.headers, options.proxySecret);
      if (!effective.ok) return reject(res, 403, effective.message);
      req.effectiveHost = effective.host;

      const host = normalizeHost(effective.host);
      if (!host) return reject(res, 400, 'Cabecera Host no válida');

      if (classifyHost(host, options) === 'platform') {
        req.tenant = { kind: 'platform' };
        return next();
      }

      const community = await options.lookup(host);
      if (!community) return reject(res, 404, 'Comunidad no encontrada');
      if (community.status !== 'active') return reject(res, 403, 'Comunidad suspendida');

      req.tenant = { kind: 'community', community };
      return next();
    } catch (error) {
      next(error);
    }
  };
}

export { findCommunityByHost };
