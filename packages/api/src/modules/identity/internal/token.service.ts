import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isDevelopment } from '../../../config/auth-mode';

export interface TokenPayload {
  /** Account id. Roles are deliberately *not* in the token — see AccountRepository. */
  sub: string;
}

/**
 * Access token issue and verify.
 *
 * P0.3a issues long-lived tokens so development does not mean re-authenticating
 * every hour. Short access tokens plus rotating refresh tokens in HttpOnly
 * cookies (§3.1) arrive with P8.6.
 *
 * NOTE: `JwtService` is imported as a value, not `import type`. NestJS reads
 * constructor dependencies from `emitDecoratorMetadata`, which only emits for
 * value imports — see app.module.spec.ts.
 */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(accountId: string): Promise<string> {
    return this.jwt.signAsync({ sub: accountId } satisfies TokenPayload, {
      expiresIn: isDevelopment() ? '30d' : '15m',
    });
  }

  async verify(token: string): Promise<TokenPayload> {
    try {
      return await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
