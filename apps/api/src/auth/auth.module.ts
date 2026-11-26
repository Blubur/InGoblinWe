import { Module } from '@nestjs/common';
import type { AppConfig } from '@goblins/core';
import type { Pool } from '@goblins/database';
import { APP_CONFIG, DB_POOL } from '../infra/tokens';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasher } from './password';

@Module({
  controllers: [AuthController],
  providers: [
    {
      provide: AuthService,
      inject: [DB_POOL, APP_CONFIG],
      useFactory: (pool: Pool, config: AppConfig) =>
        new AuthService(pool, new PasswordHasher(), { sessionTtlSeconds: config.SESSION_TTL_HOURS * 3600 }),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
