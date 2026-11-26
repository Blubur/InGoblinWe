import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CommunitiesModule } from './communities/communities.module';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [InfraModule, AuthModule, CommunitiesModule, PlatformModule],
  controllers: [HealthController],
})
export class AppModule {}
