import { RefundReason } from '@freshkirana/contracts';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class IssuePartialRefundDto {
  /** Integer paise. ₹80.00 is 8000. */
  @IsInt() @Min(1) amountPaise!: number;

  @IsOptional() @IsIn(Object.values(RefundReason)) reason?: RefundReason;

  /** The line this is for, when it is for one line. */
  @IsOptional() @IsUUID() orderLineId?: string;

  /**
   * The operator's own reference for this refund.
   *
   * Required, and it forms the idempotency key (rule R4). It has to come from
   * the caller because only they know whether a resubmitted form is the same
   * refund again or a genuinely second one — two underweight lines on one order
   * are two refunds, and a key derived from the order alone would silently
   * collapse them into one.
   */
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: 'reference may contain letters, digits, dot, underscore, colon and dash',
  })
  reference!: string;

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
