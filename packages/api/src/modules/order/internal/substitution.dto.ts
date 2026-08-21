import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Accepting one of the offered substitutes (spec §1.7.2).
 *
 * The offer id is checked against what the customer was actually shown, so this
 * cannot be used to substitute in something the §1.7.2 rules refused.
 */
export class AcceptSubstitutionDto {
  @IsUUID() vendorOfferId!: string;

  /**
   * Agreement to pay more than the original line cost.
   *
   * Optional, and absent means no. §1.7.2 requires *explicit* consent for a
   * dearer substitute, and a default of `true` would make the word explicit
   * meaningless — the safe reading of silence is the one that cannot overcharge
   * somebody.
   */
  @IsOptional() @IsBoolean() consented?: boolean;
}
