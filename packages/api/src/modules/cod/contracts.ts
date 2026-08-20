/**
 * Public interface of the COD module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 */

/** The §2.17.2 RiskScorer. Rules by preference, not as a placeholder (§2.17.1). */
export { RuleRiskScorer } from './internal/risk-scorer.service';

/** Thresholds ops change without a deploy (§2.10.4). */
export { CodConfigService } from './internal/cod-config.service';

/** The confirmation ceremony and its audit trail. */
export { CodConfirmationService } from './internal/cod-confirmation.service';
export type {
  OpenedConfirmation,
  VerifyOutcome,
} from './internal/cod-confirmation.service';

export { OverrideConfirmationDto, VerifyOtpDto } from './internal/cod.dto';

export {
  CodConfirmationMethod,
  CodConfirmationStatus,
  CodRiskBand,
  confirmationFor,
} from '@freshkirana/contracts';
