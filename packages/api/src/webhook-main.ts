import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { assertAuthModeIsSafe, resolveAuthMode } from './config/auth-mode';
import { loadEnv } from './config/env';
import { logger } from './observability/logger';

loadEnv();
assertAuthModeIsSafe();

const DEFAULT_PORT = 8080;

/**
 * The only paths this service will answer.
 *
 * Exported so the test asserts against the same list the middleware uses — a
 * copy in the test would drift, and the drift would be silent until something
 * was exposed.
 */
export const PUBLIC_WEBHOOK_PATHS: readonly string[] = [
  '/webhooks/razorpay',
  '/webhooks/whatsapp',
  // Cloud Run's startup probe. Answering it is not a disclosure: it says the
  // process is up, which anyone can infer from a TCP connection anyway.
  '/health',
];

export function isPubliclyReachable(path: string): boolean {
  // Compare the path only — a query string must never widen what matches.
  const clean = (path.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  return PUBLIC_WEBHOOK_PATHS.includes(clean);
}

/**
 * The public front door for provider webhooks.
 *
 * ## Why a second service exists at all
 *
 * Cloud Run's IAM is per **service**, not per route. The API is private and
 * stays that way until P8.6 ships real authentication — but Razorpay and the
 * WhatsApp BSP are anonymous callers on the internet who must be able to reach
 * exactly two endpoints. There is no way to express that on one service.
 *
 * So this runs the *same image* with a different entry point: same code, same
 * deploy, same database, and a middleware that refuses everything outside the
 * list above before routing ever happens.
 *
 * ## What actually protects it
 *
 * The signature on the request body, and nothing else. That is how every
 * payment webhook on the internet works, and it is why the signature check
 * lives before the parse (§2.10.2) rather than after it.
 *
 * The path filter is defence in depth, not the protection: it means a bug in some
 * unrelated controller cannot become a public endpoint by accident. A test
 * asserts that customer, cart and admin routes all 404 here — if that test ever
 * fails, this service has been widened and the private API is no longer private
 * in practice.
 *
 * Rate limiting belongs here too (Cloud Armor), and is not built yet.
 */
export async function createWebhookApp() {
  // Same `rawBody` as the API: the signature is over the untouched bytes.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (isPubliclyReachable(request.path)) return next();

    // 404, not 403. A 403 confirms the route exists, which tells an anonymous
    // caller what this deployment is running.
    response.status(404).json({ statusCode: 404, message: 'Not Found' });
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  app.enableShutdownHooks();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createWebhookApp();

  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  await app.listen(port);

  logger.info(
    { port, authMode: resolveAuthMode(), paths: PUBLIC_WEBHOOK_PATHS },
    'freshkirana-webhooks listening — public, signature-gated',
  );
}

if (require.main === module) {
  void bootstrap();
}
