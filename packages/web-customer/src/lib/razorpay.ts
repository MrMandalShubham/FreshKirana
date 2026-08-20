/**
 * Razorpay Checkout, loaded on demand (B3, §2.10.1).
 *
 * On the client because that is the only place it can be: UPI intent hands the
 * customer to their bank's app, and only a browser can do that. Nothing here
 * decides whether the order is paid — the handler fires when the customer
 * finishes in Checkout, which is a *hint* that money is coming, not proof. The
 * signed webhook is the only thing that marks an order paid (§2.10.2), so the
 * worst a tampered browser can do is make this page reload early.
 *
 * Loaded on demand rather than in the layout: it is a third-party script on the
 * critical path of every page otherwise, and P1.5's budget is 200 KB.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface CheckoutOptions {
  keyId: string;
  providerOrderId: string;
  amountPaise: number;
  /** The customer finished in Checkout. The webhook still decides. */
  onSubmitted: () => void;
  /** They closed it without paying, or it failed. */
  onClosed: () => void;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): { open: () => void };
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loading: Promise<boolean> | null = null;

function loadScript(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  // Cached, so tapping "pay again" twice does not add a second script tag.
  loading ??= new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => {
      loading = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });

  return loading;
}

export async function openCheckout(options: CheckoutOptions): Promise<boolean> {
  const ready = await loadScript();
  if (!ready || !window.Razorpay) {
    options.onClosed();
    return false;
  }

  const checkout = new window.Razorpay({
    key: options.keyId,
    order_id: options.providerOrderId,
    amount: options.amountPaise,
    currency: 'INR',
    name: 'FreshKirana',
    // UPI first, because it is the method almost every Indian shopper uses and
    // the only one this build can service end to end (§2.10.1).
    config: { display: { blocks: {}, sequence: ['block.upi'], preferences: {} } },
    handler: () => options.onSubmitted(),
    modal: { ondismiss: () => options.onClosed() },
  });

  checkout.open();
  return true;
}
