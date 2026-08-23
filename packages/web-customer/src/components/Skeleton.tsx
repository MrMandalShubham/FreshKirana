/**
 * Loading placeholders (§4.2).
 *
 * Shaped like the content that is coming, not a spinner. Two reasons, and the
 * second is the one that matters: a spinner says "wait" while a skeleton says
 * "here is what you are getting", and because the shapes match, the page does
 * not jump when the data lands.
 *
 * Server components with no state — these render instantly as Next's
 * `loading.tsx` while the real page awaits its data.
 *
 * Every wrapper carries `aria-hidden` and the route announces its own busy
 * state, because a screen reader reading out fourteen empty grey boxes is
 * worse than silence.
 */

export function SkeletonText({ width = '100%' }: { width?: string }) {
  return <span className="sk-line" style={{ width }} />;
}

/** A row in a list — image, two lines, a price. */
export function SkeletonRow() {
  return (
    <div className="sk-row">
      <span className="sk-box" />
      <span className="sk-stack">
        <SkeletonText width="62%" />
        <SkeletonText width="38%" />
      </span>
      <SkeletonText width="52px" />
    </div>
  );
}

/** A product card in a grid. */
export function SkeletonCard() {
  return (
    <div className="sk-card">
      <span className="sk-tile" />
      <SkeletonText width="84%" />
      <SkeletonText width="46%" />
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="product-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
