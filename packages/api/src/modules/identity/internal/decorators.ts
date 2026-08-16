import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Principal, Role } from '@freshkirana/contracts';

export const IS_PUBLIC_KEY = 'freshkirana:isPublic';
export const REQUIRED_ROLES_KEY = 'freshkirana:requiredRoles';

/**
 * Opts a route out of authentication.
 *
 * Authentication is deny-by-default (§3.2): every route requires a principal
 * unless it says otherwise here. A new endpoint is unreachable until someone
 * makes a deliberate decision about who may call it.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Requires the caller to hold at least one of these roles.
 *
 * Role alone is never sufficient for vendor-scoped resources — the handler must
 * still check the scope with `hasRoleAtVendor` (§3.2). This decorator is the
 * coarse filter, not the whole authorisation.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);

interface RequestWithPrincipal {
  principal?: Principal;
}

/** Injects the authenticated principal into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal | undefined =>
    ctx.switchToHttp().getRequest<RequestWithPrincipal>().principal,
);
