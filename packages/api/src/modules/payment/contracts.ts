/**
 * Public interface of the payment module.
 *
 * The ONLY file other modules may import from. Every export here is a
 * deliberate widening of this module's public surface (spec §2.1.1).
 *
 * `checkout` starts a payment; `order` decides what a captured one means. This
 * module never touches an order status — that separation is what makes the
 * §2.6.2 orthogonality real rather than a diagram.
 */

export { PaymentService } from './internal/payment.service';
export type { AppliedPayment, StartPaymentInput } from './internal/payment.service';

export { PAYMENT_PROVIDER, MockRazorpayProvider } from './internal/razorpay.provider';
export { LiveRazorpayProvider } from './internal/razorpay.live-provider';

export type { PaymentRow, PaymentEventRow } from './schema';

export {
  PAYMENT_WINDOW_MINUTES,
  PaymentMethod,
  PaymentStatus,
  isSettled,
  needsGateway,
  supportsAuthorisationHold,
} from '@freshkirana/contracts';
export type {
  PaymentEvent,
  PaymentIntent,
  PaymentProvider,
} from '@freshkirana/contracts';
