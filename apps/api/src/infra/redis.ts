import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { describeError } from '@goblins/core';

const LOG_INTERVAL_MS = 10_000;

export function createRedis(url: string): Redis {
  const logger = new Logger('Redis');
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });

  // ioredis emite 'error' en cada reintento; sin manejador sería ruido sin control.
  let lastLog = 0;
  redis.on('error', (error) => {
    const now = Date.now();
    if (now - lastLog < LOG_INTERVAL_MS) return;
    lastLog = now;
    logger.warn(`error de conexión: ${describeError(error)}`);
  });

  return redis;
}
