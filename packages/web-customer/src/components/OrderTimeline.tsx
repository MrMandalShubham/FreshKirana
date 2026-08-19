import type { CustomerTimeline } from '@freshkirana/contracts';
import { type Locale, getDictionary } from '@/i18n/dictionaries';

/**
 * The order's progress (spec §2.6.3, §4.2).
 *
 * Five steps, not seventeen. The state machine's internal states are the
 * store's business — a shopper wants to know whether their order is being
 * packed, not that it moved from PICKING to SUBSTITUTION_PENDING.
 *
 * Every step carries a word as well as a mark, because colour and position
 * alone must not convey meaning (§4.5): a screen reader reads "done" and
 * "now", and so does anyone who cannot distinguish the dots.
 */
export function OrderTimeline({
  timeline,
  locale,
}: {
  timeline: CustomerTimeline;
  locale: Locale;
}) {
  const t = getDictionary(locale);

  const stepLabel: Record<string, string> = {
    PLACED: t.stepPlaced,
    CONFIRMED: t.stepConfirmed,
    PACKING: t.stepPacking,
    ON_THE_WAY: t.stepOnTheWay,
    DELIVERED: t.stepDelivered,
  };

  const stateLabel: Record<string, string> = {
    DONE: t.stepDone,
    CURRENT: t.stepNow,
    UPCOMING: t.stepUpcoming,
    SKIPPED: t.stepNotReached,
  };

  return (
    <ol className="timeline">
      {timeline.steps.map((step) => (
        <li key={step.step} className={`timeline-step ${step.state.toLowerCase()}`}>
          <span className="timeline-mark" aria-hidden="true" />

          <span className="timeline-body">
            <span className="timeline-label">{stepLabel[step.step] ?? step.step}</span>

            <span className="muted">
              {step.at ? formatTime(step.at, locale) : stateLabel[step.state]}
            </span>
          </span>

          <span className="skip-link">{stateLabel[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}

function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}
