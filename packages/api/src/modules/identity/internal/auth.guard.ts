import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Principal, type Role, hasRole } from '@freshkirana/contracts';
import { AccountRepository } from './account.repository';
import { IS_PUBLIC_KEY, REQUIRED_ROLES_KEY } from './decorators';
import { TokenService } from './token.service';

interface RequestWithPrincipal {
  headers: Record<string, string | string[] | undefined>;
  principal?: Principal;
}

/**
 * Authentication and coarse role authorisation, applied globally.
 *
 * Deny-by-default (§3.2): a route with no `@Public()` and no `@Roles()` still
 * requires a valid principal. Adding an endpoint without thinking about access
 * yields 401, not an open door.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly accounts: AccountRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      await this.attachPrincipalIfSignedIn(request);
      return true;
    }

    const token = extractBearerToken(request.headers['authorization']);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const payload = await this.tokens.verify(token);
    const principal = await this.accounts.findPrincipal(payload.sub);
    if (!principal) {
      throw new UnauthorizedException('Account not found or not active');
    }

    request.principal = principal;

    const required = this.reflector.getAllAndOverride<Role[]>(
      REQUIRED_ROLES_KEY,
      targets,
    );
    if (required && required.length > 0 && !hasRole(principal, ...required)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }

  /**
   * Resolves the principal on a public route, when there is one.
   *
   * Public does not mean anonymous. The cart is the clearest case: it is public
   * because a basket exists before signup, but a signed-in shopper sending a
   * token must be recognised — otherwise they are handed an anonymous basket
   * and cannot see the cart they just claimed.
   *
   * A bad or expired token is *ignored* rather than rejected. On a route that
   * works without any token at all, 401 would be a strange answer, and a stale
   * token left in a browser would lock a shopper out of browsing entirely.
   * Routes where the token must be good are simply not public.
   */
  private async attachPrincipalIfSignedIn(request: RequestWithPrincipal): Promise<void> {
    const token = extractBearerToken(request.headers['authorization']);
    if (!token) return;

    try {
      const payload = await this.tokens.verify(token);
      const principal = await this.accounts.findPrincipal(payload.sub);
      if (principal) request.principal = principal;
    } catch {
      // Anonymous, deliberately.
    }
  }
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const [scheme, token] = value.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
