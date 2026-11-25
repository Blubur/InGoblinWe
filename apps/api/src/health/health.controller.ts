import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Pool } from '@goblins/database';
import { DB_POOL, REDIS } from '../infra/tokens';
import { runCheck } from './run-check';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: el proceso responde. No toca ningún servicio externo. */
  @Get()
  live() {
    return { status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: PostgreSQL y Redis responden. Devuelve 503 con el detalle si alguno falla. */
  @Get('ready')
  async ready() {
    const [database, redis] = await Promise.all([
      runCheck(() => this.pool.query('SELECT 1')),
      runCheck(async () => {
        const reply = await this.redis.ping();
        if (reply !== 'PONG') throw new Error(`respuesta inesperada: ${reply}`);
      }),
    ]);

    const body = {
      status: database.ok && redis.ok ? ('ok' as const) : ('error' as const),
      checks: { database, redis },
    };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
