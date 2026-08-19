/**
 * Public interface of the COD module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 */

/** The §2.17.2 RiskScorer. Rules by preference, not as a placeholder (§2.17.1). */
export { RuleRiskScorer } from './internal/risk-scorer.service';

export { CodRiskBand } from '@freshkirana/contracts';
