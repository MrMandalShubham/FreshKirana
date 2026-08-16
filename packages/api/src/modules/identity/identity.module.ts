import { Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { isDevelopment } from '../../config/auth-mode';
import { AccountRepository } from './internal/account.repository';
import { AuthGuard } from './internal/auth.guard';
import { DevAuthController } from './internal/dev-auth.controller';
import { DevAuthService } from './internal/dev-auth.service';
import { MeController } from './internal/me.controller';
import { TokenService } from './internal/token.service';

/**
 * Identity module — authentication and authorisation (spec §3.1, §3.2).
 *
 * Owns the `identity` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * P0.3a scope: the identity *model*, RBAC guards and resource scoping, plus a
 * development-only login. The authentication *ceremony* — OTP, refresh
 * rotation, rate limiting, MFA — is P8.6.
 */
const devOnlyProviders: Provider[] = isDevelopment() ? [DevAuthService] : [];

@Module({
  imports: [
    JwtModule.register({
      global: true,
      // Dev default keeps `npm run db:reset` frictionless; production is gated
      // by assertAuthModeIsSafe() long before this matters.
      secret: process.env['JWT_SECRET'] ?? 'freshkirana-dev-secret-not-for-production',
      signOptions: { issuer: 'freshkirana' },
    }),
  ],
  controllers: isDevelopment() ? [MeController, DevAuthController] : [MeController],
  providers: [
    AccountRepository,
    TokenService,
    ...devOnlyProviders,
    // Global: authentication is deny-by-default across every route (§3.2).
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AccountRepository],
})
export class IdentityModule {}
