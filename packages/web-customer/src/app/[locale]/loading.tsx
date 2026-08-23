import { SkeletonGrid, SkeletonList } from '@/components/Skeleton';

/**
 * Shown while the home page waits on the catalogue and the shopper's history.
 *
 * `role="status"` with a single label, rather than letting a screen reader
 * enumerate the placeholder boxes — hence `aria-hidden` on the shapes.
 */
export default function HomeLoading() {
  return (
    <main className="container" role="status" aria-label="Loading">
      <div className="hero-card sk-hero" aria-hidden="true" />
      <div className="section">
        <SkeletonList count={3} />
      </div>
      <div className="section">
        <SkeletonGrid count={8} />
      </div>
    </main>
  );
}
