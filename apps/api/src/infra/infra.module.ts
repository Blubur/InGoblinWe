import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { parseConfig, describeError, type AppConfig } from '@goblins/core';
import { createPool, type Pool } from '@goblins/database';
import { createRedis } from './redis';
import { APP_CONFIG, DB_POOL, REDIS } from './tokens';

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): AppConfig => parseConfig(process.env) },
    {
      provide: DB_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Pool => {
        const logger = new Logger('Database');
        return createPool(config.DATABASE_URL, (error) =>
          logger.warn(`error en un cliente inactivo: ${describeError(error)}`),
        );
      },
    },
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Redis => createRedis(config.REDIS_URL),
    },
  ],
  exports: [APP_CONFIG, DB_POOL, REDIS],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }
}
