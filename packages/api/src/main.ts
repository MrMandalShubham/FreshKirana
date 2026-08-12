import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  await app.listen(port);

  // Replaced by structured logging in P0.4.
  console.warn(`freshkirana-api listening on port ${port}`);
}

void bootstrap();
