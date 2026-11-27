import { Module } from '@nestjs/common';
import type { Pool } from '@goblins/database';
import { DB_POOL } from '../infra/tokens';
import { ForumController } from './forum.controller';
import { ForumService } from './forum.service';

@Module({
  controllers: [ForumController],
  providers: [
    {
      provide: ForumService,
      inject: [DB_POOL],
      useFactory: (pool: Pool) => new ForumService(pool),
    },
  ],
})
export class ForumModule {}
