import { InventoryMode } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const OfferStatus = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ARCHIVED',
} as const;

export class CreateOfferDto {
  @IsUUID() masterProductId!: string;

  /** Integer paise. ₹250.00 is 25000. */
  @IsInt() @Min(1) mrpPaise!: number;
  @IsInt() @Min(1) sellingPricePaise!: number;

  @IsOptional() @IsIn(Object.values(InventoryMode)) inventoryMode?: InventoryMode;
  @IsOptional() @IsInt() @Min(0) stockOnHand?: number;
  @IsOptional() @IsInt() @Min(0) lowStockThreshold?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;

  @IsOptional() @IsString() @MaxLength(50) batchNo?: string;
  @IsOptional() @IsISO8601() mfgDate?: string;
  @IsOptional() @IsISO8601() expiryDate?: string;
}

export class UpdateOfferDto {
  @IsOptional() @IsInt() @Min(1) mrpPaise?: number;
  @IsOptional() @IsInt() @Min(1) sellingPricePaise?: number;
  @IsOptional() @IsIn(Object.values(InventoryMode)) inventoryMode?: InventoryMode;
  @IsOptional() @IsInt() @Min(0) stockOnHand?: number;
  @IsOptional() @IsInt() @Min(0) lowStockThreshold?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsString() @MaxLength(50) batchNo?: string;
  @IsOptional() @IsISO8601() mfgDate?: string;
  @IsOptional() @IsISO8601() expiryDate?: string;
  @IsOptional() @IsIn(Object.values(OfferStatus)) status?: string;
}

export class ListOffersQueryDto {
  @IsOptional() @IsIn(Object.values(OfferStatus)) status?: string;
  @IsOptional() @IsBoolean() @Type(() => Boolean) lowStockOnly?: boolean;

  // Query values are always strings — see the P1.1 note on @Type.
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
