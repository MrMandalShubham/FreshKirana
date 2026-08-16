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

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
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
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const [scheme, token] = value.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
