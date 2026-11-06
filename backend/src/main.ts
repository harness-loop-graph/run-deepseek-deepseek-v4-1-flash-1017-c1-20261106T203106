import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { createValidationPipe } from './common/validation.pipe';
import { APP_CONFIG, AppConfig } from './config';
import { DatabaseBootstrap } from './database/database.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('');
  app.enableCors({
    origin: config.spaOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Retry-After'],
    credentials: false,
    maxAge: 600,
  });
  app.enableShutdownHooks();

  await app.get(DatabaseBootstrap).start(config);
  await app.listen(config.port, '0.0.0.0');
  logger.log(`API listening on port ${config.port}`);
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    `Fatal startup error: ${error instanceof Error ? error.message : 'unknown'}`,
  );
  process.exit(1);
});
