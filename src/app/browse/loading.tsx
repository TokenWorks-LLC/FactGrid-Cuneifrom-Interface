import { Skeleton } from "@/components/ui/skeleton";

export default function BrowseLoading() {
  return (
    <main id="main-content" aria-busy="true" aria-label="Loading the tablet catalogue" className="site-container py-12 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-14">
        <div>
          <Skeleton className="h-11 w-48 rounded-none" />
          <Skeleton className="mt-5 h-20 w-full rounded-none" />
          <Skeleton className="mt-8 h-72 w-full rounded-none" />
        </div>
        <div>
          <Skeleton className="h-12 w-72 max-w-full rounded-none" />
          <div className="mt-7 space-y-0 border-t border-border">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="border-b border-border py-7" key={index}>
                <Skeleton className="h-8 w-2/3 rounded-none" />
                <Skeleton className="mt-3 h-5 w-full rounded-none" />
                <Skeleton className="mt-2 h-5 w-4/5 rounded-none" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
