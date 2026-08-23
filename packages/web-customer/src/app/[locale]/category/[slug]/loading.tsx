import { SkeletonGrid } from '@/components/Skeleton';

export default function CategoryLoading() {
  return (
    <main className="container" role="status" aria-label="Loading">
      <div className="section">
        <SkeletonGrid count={8} />
      </div>
    </main>
  );
}
