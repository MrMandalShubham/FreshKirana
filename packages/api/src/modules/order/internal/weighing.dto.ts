import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/**
 * What the scale said (spec §1.7.1).
 *
 * Grams, as an integer. A float would be the wrong type for a measurement that
 * has to reconcile against money — and every Indian shop scale reads whole
 * grams anyway.
 */
export class WeighLineDto {
  // Capped at 50 kg: a single grocery line above that is a typo, and a typo
  // here charges somebody for fifty kilos of tomatoes.
  @Type(() => Number) @IsInt() @Min(0) @Max(50_000) actualGrams!: number;

  /**
   * The customer agreed to a weight outside the tolerance band.
   *
   * Absent means no, like every other consent in this system: §1.7.1 requires
   * the customer be asked, and a default of `true` would make the asking
   * decorative.
   */
  @IsOptional() @IsBoolean() consented?: boolean;

  /**
   * The lot this line came out of (§1.7.3).
   *
   * Optional because a picker with no scanner should not be blocked from
   * recording a weight — but every line without it is a line a recall cannot
   * trace, which is why P7.1's dashboard makes it the default path.
   */
  @IsOptional() @IsUUID() offerBatchId?: string;
}
