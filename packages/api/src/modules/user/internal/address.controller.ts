import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AddressLabel, type Principal } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CurrentUser } from '../../identity/contracts';
import { AddressService } from './address.service';

const PHONE = /^\+91[6-9]\d{9}$/;

export class CreateAddressDto {
  @IsOptional() @IsIn(Object.values(AddressLabel)) label?: string;

  @IsString() @MinLength(2) @MaxLength(120) recipientName!: string;

  @Matches(PHONE, {
    message: 'recipientPhone must be an Indian mobile number, +91XXXXXXXXXX',
  })
  recipientPhone!: string;

  @IsString() @MinLength(3) @MaxLength(300) line1!: string;
  @IsOptional() @IsString() @MaxLength(300) line2?: string;
  @IsOptional() @IsString() @MaxLength(200) landmark?: string;

  @IsString() @MinLength(2) @MaxLength(120) city!: string;
  @IsString() @MinLength(2) @MaxLength(120) state!: string;

  @Matches(/^[1-9]\d{5}$/, { message: 'pincode must be six digits' })
  pincode!: string;

  // The pin, not the text, decides serviceability — see schema.ts.
  @Type(() => Number) @IsLatitude() latitude!: number;
  @Type(() => Number) @IsLongitude() longitude!: number;

  @IsOptional() @IsString() @MaxLength(300) deliveryNote?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateAddressDto {
  @IsOptional() @IsIn(Object.values(AddressLabel)) label?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) recipientName?: string;
  @IsOptional() @Matches(PHONE) recipientPhone?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(300) line1?: string;
  @IsOptional() @IsString() @MaxLength(300) line2?: string;
  @IsOptional() @IsString() @MaxLength(200) landmark?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) state?: string;
  @IsOptional() @Matches(/^[1-9]\d{5}$/) pincode?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsOptional() @IsString() @MaxLength(300) deliveryNote?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

/**
 * The shopper's own addresses (spec §1.5.1).
 *
 * Every route is scoped to the caller's account rather than taking an account
 * id from the path: there is no way to express "someone else's address" in this
 * API at all, which is a stronger guarantee than checking one (§3.2).
 */
@Controller('me/addresses')
export class AddressController {
  constructor(private readonly addresses: AddressService) {}

  @Get()
  list(@CurrentUser() principal: Principal) {
    return this.addresses.list(principal.accountId);
  }

  @Get(':addressId')
  get(@CurrentUser() principal: Principal, @Param('addressId') addressId: string) {
    return this.addresses.get(principal.accountId, addressId);
  }

  @Post()
  create(@CurrentUser() principal: Principal, @Body() dto: CreateAddressDto) {
    return this.addresses.create(principal.accountId, dto);
  }

  @Patch(':addressId')
  update(
    @CurrentUser() principal: Principal,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(principal.accountId, addressId, dto);
  }

  @Patch(':addressId/default')
  makeDefault(
    @CurrentUser() principal: Principal,
    @Param('addressId') addressId: string,
  ) {
    return this.addresses.makeDefault(principal.accountId, addressId);
  }

  @Delete(':addressId')
  async remove(
    @CurrentUser() principal: Principal,
    @Param('addressId') addressId: string,
  ) {
    await this.addresses.remove(principal.accountId, addressId);
    return { removed: true };
  }
}
