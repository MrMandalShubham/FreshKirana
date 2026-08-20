import { COD_OTP_LENGTH } from '@freshkirana/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * A patch, not a replacement.
 *
 * Every field optional so an operator tightening one number does not have to
 * restate the other seven — a form that resubmits stale values for untouched
 * fields is how one change silently reverts another. Cross-field validity
 * (cutoffs must climb) is checked in `contracts`, against the merged result,
 * because it cannot be seen one field at a time.
 */
export class UpdateThresholdsDto {
  @IsOptional() @IsInt() @Min(0) highValuePaise?: number;
  @IsOptional() @IsInt() @Min(0) veryHighValuePaise?: number;
  @IsOptional() @IsInt() @Min(1) rtoBlockCount?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100) mediumScore?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) highScore?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) blockedScore?: number;

  // Capped at a day: a window longer than that is not a confirmation, it is an
  // order sitting on stock nobody else can buy.
  @IsOptional() @IsInt() @Min(1) @Max(1_440) confirmationWindowMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5_000)
  @Matches(/^[1-9][0-9]{5}$/, { each: true, message: 'each must be an Indian PIN code' })
  blockedPincodes?: string[];
}

export class AccountDecisionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class VerifyOtpDto {
  @IsString()
  @Length(COD_OTP_LENGTH, COD_OTP_LENGTH)
  @Matches(/^[0-9]+$/, { message: 'code must be digits' })
  code!: string;
}

/**
 * An operator deciding for the customer (§2.10.4).
 *
 * The note is required, not optional. An override with no reason is an
 * unattributable decision, and the whole point of logging overrides is that
 * somebody can be asked about them later.
 */
export class OverrideConfirmationDto {
  @IsString() @MaxLength(500) note!: string;
}
