import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { assertAuthModeIsSafe, isDevelopment, resolveAuthMode } from './config/auth-mode';
import { loadEnv } from './config/env';
import { logger } from './observability/logger';

loadEnv();

// Before anything binds a port: refuse to run dev auth outside development.
// See config/auth-mode.ts — this is the gate that stops P8.6 being forgotten.
assertAuthModeIsSafe();

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  // `rawBody` keeps the untouched request bytes available alongside the parsed
  // body. The payment webhook's signature is computed over those bytes, and a
  // re-serialised JSON body can differ in whitespace and key order (§2.10.2).
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  await app.listen(port);

  logger.info({ port, authMode: resolveAuthMode() }, 'freshkirana-api listening');
  if (isDevelopment()) {
    logger.warn('dev auth enabled — POST /dev/login-as {"role":"CUSTOMER"}');
  }
}

void bootstrap();
