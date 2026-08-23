import { SkeletonList } from '@/components/Skeleton';

export default function OrdersLoading() {
  return (
    <main className="container" role="status" aria-label="Loading">
      <div className="section">
        <SkeletonList count={4} />
      </div>
    </main>
  );
}
