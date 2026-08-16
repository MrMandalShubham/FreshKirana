import { pino, type Logger, type LoggerOptions } from 'pino';
import { isDevelopment } from '../config/auth-mode';
import { getContext } from './correlation';

/**
 * Paths scrubbed from every log line.
 *
 * §3.5 requires PII minimisation, and logs are the easiest place to leak it:
 * they are shipped to third-party aggregators, retained beyond the data they
 * describe, and readable by anyone with production access. Redaction is applied
 * centrally rather than trusting each call site to remember.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'phone',
  '*.phone',
  'otp',
  '*.otp',
  'password',
  '*.password',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'displayName',
  '*.displayName',
  'address',
  '*.address',
  'cardNumber',
  '*.cardNumber',
  'vpa',
  '*.vpa',
];

function baseOptions(): LoggerOptions {
  return {
    level: process.env['LOG_LEVEL'] ?? (isDevelopment() ? 'debug' : 'info'),
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    base: { service: 'freshkirana-api' },
    // Structured, sortable, and unambiguous across timezones.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    /**
     * Stamps the ambient request context onto every line, so
     * `grep <correlationId>` returns the whole story of one request without
     * any call site passing it explicitly.
     */
    mixin() {
      const context = getContext();
      if (!context) return {};
      return {
        correlationId: context.correlationId,
        ...(context.accountId ? { accountId: context.accountId } : {}),
        ...(context.route ? { route: context.route } : {}),
      };
    },
  };
}

export function createLogger(): Logger {
  if (isDevelopment()) {
    return pino({
      ...baseOptions(),
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    });
  }
  return pino(baseOptions());
}

export const logger: Logger = createLogger();
