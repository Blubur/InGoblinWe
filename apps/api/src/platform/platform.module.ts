import { Module } from '@nestjs/common';
import type { Pool } from '@goblins/database';
import { DB_POOL } from '../infra/tokens';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  controllers: [PlatformController],
  providers: [
    {
      provide: PlatformService,
      inject: [DB_POOL],
      useFactory: (pool: Pool) => new PlatformService(pool),
    },
  ],
})
export class PlatformModule {}
