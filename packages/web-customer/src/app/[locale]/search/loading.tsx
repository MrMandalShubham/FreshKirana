import { SkeletonGrid } from '@/components/Skeleton';

export default function SearchLoading() {
  return (
    <main className="container" role="status" aria-label="Loading">
      <div className="section">
        <SkeletonGrid count={6} />
      </div>
    </main>
  );
}
