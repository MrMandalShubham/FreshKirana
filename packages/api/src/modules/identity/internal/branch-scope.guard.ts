import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { type Principal, Role, hasRole, hasRoleAtVendor } from '@freshkirana/contracts';

interface ScopedRequest {
  principal?: Principal;
  params?: Record<string, string>;
}

/**
 * Enforces §3.2 resource-level scoping on any route with a `:branchId` param.
 *
 * `@Roles(VENDOR_STAFF)` is *not* authorisation for a branch resource: every
 * shop's staff holds that same role, so the role alone would let staff of shop
 * A read shop B's orders and stock. Only the scope distinguishes them, and
 * branch-to-branch data leakage is the failure that destroys marketplace trust.
 *
 * Admin and ops legitimately operate across all branches, so they bypass the
 * scope check — but they still had to pass authentication and the route's own
 * `@Roles`.
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const principal = request.principal;

    if (!principal) {
      throw new ForbiddenException('No authenticated principal');
    }

    const branchId = request.params?.['branchId'];
    if (!branchId) {
      // A programming error, not a client one: the guard is on a route that has
      // no branchId to scope against. Fail closed rather than allow.
      throw new ForbiddenException('Route is vendor-scoped but has no :branchId param');
    }

    if (hasRole(principal, Role.ADMIN, Role.OPS)) {
      return true;
    }

    if (!hasRoleAtVendor(principal, branchId, Role.VENDOR_OWNER, Role.VENDOR_STAFF)) {
      throw new ForbiddenException('You do not hold a role at this vendor');
    }

    return true;
  }
}
