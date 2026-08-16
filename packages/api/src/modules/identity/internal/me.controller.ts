import { Controller, Get } from '@nestjs/common';
import { Role, type Principal } from '@freshkirana/contracts';
import { CurrentUser, Roles } from './decorators';

@Controller()
export class MeController {
  /**
   * The authenticated principal.
   *
   * No `@Public()`, so the global AuthGuard requires a valid token — this is
   * deny-by-default in practice (§3.2).
   */
  @Get('me')
  me(@CurrentUser() principal: Principal): Principal {
    return principal;
  }

  /**
   * Role-gated probe. Exists to make the 403 path observable in the P0.3a
   * confirmation test; harmless to keep as a permission smoke check.
   */
  @Roles(Role.ADMIN)
  @Get('admin/ping')
  adminPing(@CurrentUser() principal: Principal): { ok: true; accountId: string } {
    return { ok: true, accountId: principal.accountId };
  }
}
