import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main id="main-content" className="site-container py-20">
      <div className="max-w-2xl border-y border-border py-10">
        <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">Not found</p>
        <h1 className="mt-5 font-heading text-4xl font-medium tracking-[-0.025em]">
          This tablet record is not available
        </h1>
        <p className="mt-4 max-w-[58ch] leading-7 text-muted-foreground">
          Check the FactGrid QID, or return to the catalogue to find another record.
        </p>
        <Link
          className={cn(buttonVariants(), "mt-7 min-h-11 rounded-none px-4")}
          href="/browse"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Browse tablets
        </Link>
      </div>
    </main>
  );
}
