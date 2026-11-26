import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CommunitiesModule } from './communities/communities.module';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [InfraModule, AuthModule, CommunitiesModule],
  controllers: [HealthController],
})
export class AppModule {}
