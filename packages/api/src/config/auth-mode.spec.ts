import { describe, expect, it } from 'vitest';
import {
  AuthMode,
  UnsafeAuthModeError,
  assertAuthModeIsSafe,
  isDevelopment,
  resolveAuthMode,
} from './auth-mode';

describe('isDevelopment', () => {
  it('treats development, test and unset as development', () => {
    expect(isDevelopment('development')).toBe(true);
    expect(isDevelopment('test')).toBe(true);
    expect(isDevelopment(undefined)).toBe(true);
  });

  it('treats staging and production as not development', () => {
    expect(isDevelopment('staging')).toBe(false);
    expect(isDevelopment('production')).toBe(false);
  });
});

describe('resolveAuthMode', () => {
  it('defaults to dev', () => {
    expect(resolveAuthMode({})).toBe(AuthMode.DEV);
    expect(resolveAuthMode({ AUTH_MODE: 'anything-else' })).toBe(AuthMode.DEV);
  });

  it('honours an explicit real mode', () => {
    expect(resolveAuthMode({ AUTH_MODE: 'real' })).toBe(AuthMode.REAL);
  });
});

describe('assertAuthModeIsSafe - the P8.6 gate', () => {
  it('allows dev auth in development and test', () => {
    expect(() => assertAuthModeIsSafe({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertAuthModeIsSafe({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => assertAuthModeIsSafe({})).not.toThrow();
  });

  it('REFUSES to start in production with dev auth', () => {
    expect(() => assertAuthModeIsSafe({ NODE_ENV: 'production' })).toThrow(
      UnsafeAuthModeError,
    );
  });

  it('refuses in staging too', () => {
    expect(() => assertAuthModeIsSafe({ NODE_ENV: 'staging' })).toThrow(
      UnsafeAuthModeError,
    );
  });

  it('names P8.6 in the failure so the fix is discoverable', () => {
    let message = '';
    try {
      assertAuthModeIsSafe({ NODE_ENV: 'production' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('P8.6');
  });

  it('permits production once real auth exists', () => {
    expect(() =>
      assertAuthModeIsSafe({ NODE_ENV: 'production', AUTH_MODE: 'real' }),
    ).not.toThrow();
  });
});
