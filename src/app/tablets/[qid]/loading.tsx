import { Skeleton } from "@/components/ui/skeleton";

export default function TabletLoading() {
  return (
    <main id="main-content" aria-busy="true" aria-label="Loading the tablet record">
      <div className="border-b border-border bg-secondary/45">
        <div className="site-container py-14">
          <Skeleton className="h-4 w-24 rounded-none" />
          <Skeleton className="mt-8 h-16 w-[32rem] max-w-full rounded-none" />
          <Skeleton className="mt-5 h-6 w-[42rem] max-w-full rounded-none" />
        </div>
      </div>
      <div className="site-container grid gap-14 py-16 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Skeleton className="h-[34rem] rounded-none" />
        <div>
          <Skeleton className="h-10 w-64 rounded-none" />
          <Skeleton className="mt-8 h-80 w-full rounded-none" />
        </div>
      </div>
    </main>
  );
}
