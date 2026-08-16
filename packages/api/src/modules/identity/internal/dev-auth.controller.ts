import { Body, Controller, Get, Post } from '@nestjs/common';
import { ROLES, type Role } from '@freshkirana/contracts';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { DevAuthService } from './dev-auth.service';
import { Public } from './decorators';

export class DevLoginDto {
  @IsIn(ROLES)
  role!: Role;

  /** Vendor to scope a VENDOR_OWNER/VENDOR_STAFF login to. Defaults to seed vendor A. */
  @IsOptional()
  @IsString()
  vendorId?: string;
}

/**
 * Development-only login. **Never registered outside development** — see
 * IdentityModule, and the boot-time gate in config/auth-mode.ts.
 *
 * This exists so that building and testing the remaining parts does not
 * require an OTP round trip every time. Real authentication is P8.6.
 */
@Controller('dev')
export class DevAuthController {
  constructor(private readonly devAuth: DevAuthService) {}

  /** Lists the seeded accounts, so you can see what you can log in as. */
  @Public()
  @Get('accounts')
  async accounts() {
    return this.devAuth.listSeededAccounts();
  }

  /**
   * Issues a token for a seeded account holding `role`.
   *
   * curl -X POST localhost:3000/dev/login-as \
   *   -H 'Content-Type: application/json' -d '{"role":"CUSTOMER"}'
   */
  @Public()
  @Post('login-as')
  async loginAs(@Body() dto: DevLoginDto) {
    return this.devAuth.loginAs(dto.role, dto.vendorId);
  }
}
