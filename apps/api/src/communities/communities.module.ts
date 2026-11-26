import { Module } from '@nestjs/common';
import type { AppConfig } from '@goblins/core';
import type { Pool } from '@goblins/database';
import { APP_CONFIG, DB_POOL } from '../infra/tokens';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';

@Module({
  controllers: [CommunitiesController],
  providers: [
    {
      provide: CommunitiesService,
      inject: [DB_POOL, APP_CONFIG],
      useFactory: (pool: Pool, config: AppConfig) => new CommunitiesService(pool, config.PLATFORM_BASE_DOMAIN),
    },
  ],
})
export class CommunitiesModule {}
