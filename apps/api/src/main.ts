import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigError, loadRootEnv, parseConfig } from '@goblins/core';
import { findCommunityByHost, type Pool } from '@goblins/database';
import { AppModule } from './app.module';
import { AuthService } from './auth/auth.service';
import { createAuthMiddleware } from './auth/auth.middleware';
import { sessionCookieName } from './auth/session-cookie';
import { DB_POOL } from './infra/tokens';
import { createTenantMiddleware } from './tenant/tenant.middleware';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  loadRootEnv();
  const config = parseConfig(process.env); // Falla pronto y con un mensaje claro si el .env está mal.

  // Huella del secreto del proxy (8 primeros caracteres de su SHA-256): permite comprobar que la web
  // y la API tienen el mismo valor sin escribir el secreto en los logs.
  const secret = config.PROXY_SHARED_SECRET;
  logger.log(
    secret
      ? `PROXY_SHARED_SECRET huella=${createHash('sha256').update(secret).digest('hex').slice(0, 8)} longitud=${secret.length}`
      : 'PROXY_SHARED_SECRET sin definir: se ignora el host reenviado',
  );

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  const pool = app.get<Pool>(DB_POOL);
  app.use(
    createTenantMiddleware({
      lookup: (host) => findCommunityByHost(pool, host),
      baseDomain: config.PLATFORM_BASE_DOMAIN,
      allowLoopback: config.NODE_ENV !== 'production',
      skipPathPrefixes: ['/api/v1/health'],
      proxySecret: config.PROXY_SHARED_SECRET,
    }),
  );
  app.use(
    createAuthMiddleware({
      service: app.get(AuthService),
      cookieName: sessionCookieName(config.NODE_ENV === 'production'),
    }),
  );
  app.enableShutdownHooks();

  await app.listen(config.API_PORT, config.API_HOST);
  logger.log(`API escuchando en http://${config.API_HOST}:${config.API_PORT}/api/v1`);
}

bootstrap().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
