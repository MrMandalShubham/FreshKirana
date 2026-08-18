import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AddressController } from './internal/address.controller';
import { AddressService } from './internal/address.service';

/**
 * User module — customer profiles, addresses, preferences (spec §2.2).
 *
 * Owns the `user` PostgreSQL schema. Other modules may import only from
 * `./contracts`; `./schema` and `./internal` are private (§2.1.1, rule R2).
 *
 * `serviceability` needs an address's coordinates to answer "can we deliver
 * here", which is why the row type is published rather than the table.
 */
@Module({
  imports: [IdentityModule],
  controllers: [AddressController],
  providers: [AddressService],
  exports: [AddressService],
})
export class UserModule {}
