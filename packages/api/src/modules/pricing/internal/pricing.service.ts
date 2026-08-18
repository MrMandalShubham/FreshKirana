import { Injectable } from '@nestjs/common';
import type { FeeConfig } from '@freshkirana/contracts';

/**
 * Order-level fees (spec §1.3.1).
 *
 * These are the numbers the §1.3.2 contribution model turns on, and §1.3.1 is
 * explicit that they are configuration rather than constants — tunable per city
 * without a deploy. They live here rather than in the cart because checkout,
 * orders and settlement all need the same answer, and two implementations would
 * eventually disagree about what a basket costs.
 *
 * Backed by environment variables for now; an ops-editable config table lands
 * with the admin console (P7.2).
 */
@Injectable()
export class PricingService {
  /** The planning model from §1.3.2, until a city has real numbers. */
  private readonly defaults: FeeConfig = {
    minimumOrderValuePaise: 25_000, // ₹250
    smallBasketFeePaise: 2_000, // ₹20
    freeDeliveryThresholdPaise: 50_000, // ₹500
    deliveryFeePaise: 2_500, // ₹25
    packagingFeePaise: 500, // ₹5
  };

  /**
   * Fees for a vendor's city.
   *
   * Takes a vendor id already, even though every vendor currently gets the same
   * answer: the signature is the part that is expensive to change later, once
   * callers exist across cart, checkout and settlement.
   */
  getFees(_vendorId?: string): FeeConfig {
    return {
      minimumOrderValuePaise: this.fromEnv(
        'MOV_PAISE',
        this.defaults.minimumOrderValuePaise,
      ),
      smallBasketFeePaise: this.fromEnv(
        'SMALL_BASKET_FEE_PAISE',
        this.defaults.smallBasketFeePaise,
      ),
      freeDeliveryThresholdPaise: this.fromEnv(
        'FREE_DELIVERY_THRESHOLD_PAISE',
        this.defaults.freeDeliveryThresholdPaise,
      ),
      deliveryFeePaise: this.fromEnv(
        'DELIVERY_FEE_PAISE',
        this.defaults.deliveryFeePaise,
      ),
      packagingFeePaise: this.fromEnv(
        'PACKAGING_FEE_PAISE',
        this.defaults.packagingFeePaise,
      ),
    };
  }

  /** Ignores a malformed value rather than charging something absurd. */
  private fromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined) return fallback;

    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }
}
