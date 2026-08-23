import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Stock arriving at a shop, with the lot it came in (spec §1.7.3).
 *
 * The batch number is required. A delivery recorded without one cannot be
 * recalled, and "which crate was that?" has no answer three weeks later when it
 * matters.
 */
export class ReceiveBatchDto {
  @IsString()
  @Matches(/^[A-Za-z0-9/-]{1,40}$/, {
    message: 'batchNo must be the lot code as printed, without spaces',
  })
  batchNo!: string;

  // Capped for the same reason a weight is: a slipped decimal here becomes
  // stock a shop does not have and orders it cannot fill.
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) quantity!: number;

  @IsOptional() @IsISO8601() mfgDate?: string;
  @IsOptional() @IsISO8601() expiryDate?: string;
}
