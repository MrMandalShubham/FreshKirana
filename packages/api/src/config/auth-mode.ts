/**
 * Auth mode — the guard that stops P8.6 being forgotten.
 *
 * P0.3a ships identity with a development-only login and **no real
 * authentication ceremony** (no OTP, no refresh rotation, no rate limiting).
 * That is a deliberate, recorded deferral — see the Build Plan decision log.
 *
 * The risk of such a deferral is that it quietly reaches production. So rather
 * than relying on anyone remembering, the application refuses to boot outside
 * development while dev auth is the only auth available.
 *
 * When P8.6 lands, `AUTH_MODE=real` becomes available and this gate opens.
 */

export const AuthMode = {
  /** Dev-only login, no OTP. The P0.3a default. */
  DEV: 'dev',
  /** Real OTP + refresh rotation. Implemented by P8.6. */
  REAL: 'real',
} as const;

export type AuthMode = (typeof AuthMode)[keyof typeof AuthMode];

export function isDevelopment(env = process.env['NODE_ENV']): boolean {
  return env === undefined || env === 'development' || env === 'test';
}

export function resolveAuthMode(env = process.env): AuthMode {
  return env['AUTH_MODE'] === AuthMode.REAL ? AuthMode.REAL : AuthMode.DEV;
}

export class UnsafeAuthModeError extends Error {
  constructor(nodeEnv: string) {
    super(
      [
        '',
        '  REFUSING TO START',
        '',
        `  NODE_ENV=${nodeEnv} but AUTH_MODE=dev.`,
        '',
        '  Dev auth issues tokens for any role with no credentials. It must',
        '  never run outside development.',
        '',
        '  Real authentication is Build Plan part P8.6 (deferred from P0.3 on',
        '  2026-08-12). It is not implemented yet, so this build cannot be',
        '  deployed. Implement P8.6, then set AUTH_MODE=real.',
        '',
      ].join('\n'),
    );
    this.name = 'UnsafeAuthModeError';
  }
}

/**
 * Throws unless the auth mode is safe for the current environment.
 * Called during bootstrap, before the HTTP server binds.
 */
export function assertAuthModeIsSafe(env = process.env): void {
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  if (isDevelopment(nodeEnv)) return;
  if (resolveAuthMode(env) === AuthMode.DEV) {
    throw new UnsafeAuthModeError(nodeEnv);
  }
}
