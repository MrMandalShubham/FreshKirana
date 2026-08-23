import { RecallReason } from '@freshkirana/contracts';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/**
 * Pulling a lot (spec §1.7.3).
 *
 * Product *and* batch, because a recall names a manufacturer's lot rather than
 * a product — withdrawing every packet of a brand when one lot is bad is both
 * ruinous for the vendor and a signal customers learn to ignore.
 */
export class RaiseRecallDto {
  @IsUUID() masterProductId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9/-]{1,40}$/, {
    message: 'batchNo must be the lot code as printed',
  })
  batchNo!: string;

  @IsIn(Object.values(RecallReason)) reason!: RecallReason;

  /** What a regulator will read. Optional here, expected in practice. */
  @IsOptional() @IsString() @MaxLength(1_000) note?: string;
}
