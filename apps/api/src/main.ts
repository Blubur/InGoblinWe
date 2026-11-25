import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigError, loadRootEnv, parseConfig } from '@goblins/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  loadRootEnv();
  const config = parseConfig(process.env); // Falla pronto y con un mensaje claro si el .env está mal.

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
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
