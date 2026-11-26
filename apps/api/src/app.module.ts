import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';

@Module({
  imports: [InfraModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
