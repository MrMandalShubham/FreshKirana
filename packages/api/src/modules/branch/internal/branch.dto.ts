import { InventoryMode, Role } from '@freshkirana/contracts';
import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const PINCODE = /^[1-9][0-9]{5}$/;

export const GstRegistrationType = {
  REGISTERED: 'REGISTERED',
  COMPOSITION: 'COMPOSITION',
  UNREGISTERED: 'UNREGISTERED',
} as const;

export const BranchStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

export class CreateBranchDto {
  @Matches(SLUG, { message: 'slug must be lowercase kebab-case' })
  @MaxLength(100)
  slug!: string;

  @IsString() @MinLength(1) @MaxLength(200) legalName!: string;
  @IsString() @MinLength(1) @MaxLength(200) displayName!: string;

  @Matches(E164, { message: 'phone must be E.164, e.g. +919000000001' }) phone!: string;
  @IsOptional() @IsEmail() email?: string;

  @IsString() @MinLength(1) @MaxLength(500) addressLine!: string;
  @IsString() @MinLength(1) @MaxLength(100) city!: string;
  @Matches(PINCODE, { message: 'pincode must be 6 digits' }) pincode!: string;

  @IsOptional()
  @IsIn(Object.values(GstRegistrationType))
  gstRegistrationType?: string;

  @IsOptional() @IsString() @MaxLength(15) gstin?: string;

  @IsOptional() @IsString() @MaxLength(30) fssaiLicenceNo?: string;
  @IsOptional() @IsISO8601() fssaiExpiryDate?: string;

  @IsOptional() @IsIn(Object.values(InventoryMode)) defaultInventoryMode?: InventoryMode;
  @IsOptional() @IsObject() storeConfig?: Record<string, unknown>;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() @MaxLength(200) legalName?: string;
  @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @IsOptional() @Matches(E164) phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(500) addressLine?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @Matches(PINCODE) pincode?: string;
  @IsOptional() @IsIn(Object.values(GstRegistrationType)) gstRegistrationType?: string;
  @IsOptional() @IsString() @MaxLength(15) gstin?: string;
  @IsOptional() @IsString() @MaxLength(30) fssaiLicenceNo?: string;
  @IsOptional() @IsISO8601() fssaiExpiryDate?: string;
  @IsOptional() @IsIn(Object.values(InventoryMode)) defaultInventoryMode?: InventoryMode;
  @IsOptional() @IsObject() storeConfig?: Record<string, unknown>;
  @IsOptional() @IsIn(Object.values(BranchStatus)) status?: string;
  @IsOptional() @IsString() @MaxLength(500) suspensionReason?: string;
}

/** Grants an account a role *at this branch*. The scope is the whole point (§3.2). */
export class AddBranchStaffDto {
  @Matches(E164, { message: 'phone must be E.164' }) phone!: string;
  @IsString() @MinLength(1) @MaxLength(200) displayName!: string;

  @IsIn([Role.VENDOR_OWNER, Role.VENDOR_STAFF], {
    message: 'role must be VENDOR_OWNER or VENDOR_STAFF',
  })
  role!: typeof Role.VENDOR_OWNER | typeof Role.VENDOR_STAFF;
}
