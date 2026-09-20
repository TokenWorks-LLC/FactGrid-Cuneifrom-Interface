"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { SITE } from "@/config/site";
import { cn } from "@/lib/utils";

export default function TabletError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const qid = pathname.match(/\/tablets\/(Q[1-9][0-9]{0,14})(?:\/|$)/iu)?.[1]?.toUpperCase();

  useEffect(() => {
    if (error.digest) console.error("Tablet page failed", { digest: error.digest });
  }, [error.digest]);

  return (
    <main id="main-content" className="site-container py-16 sm:py-20">
      <div className="max-w-2xl border-y border-border py-10">
        <AlertTriangle aria-hidden="true" className="size-8 text-primary" />
        {qid ? (
          <p className="mt-6 font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
            {qid}
          </p>
        ) : null}
        <h1 className="mt-3 font-heading text-4xl font-medium tracking-[-0.025em]">
          Tablet record unavailable
        </h1>
        <p className="mt-4 max-w-[58ch] leading-7 text-muted-foreground">
          The record request did not complete. FactGrid may be busy, or the application may
          have encountered an unexpected problem. This is different from a confirmed missing
          record.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button className="min-h-11 rounded-none px-4" onClick={reset} type="button">
            <RotateCcw aria-hidden="true" className="size-4" />
            Try again
          </Button>
          {qid ? (
            <a
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11 rounded-none px-4")}
              href={`${SITE.factGridOrigin}/wiki/Item:${qid}`}
              rel="noreferrer"
              target="_blank"
            >
              Open {qid} in FactGrid
            </a>
          ) : null}
          <Link
            className={cn(buttonVariants({ variant: "ghost" }), "min-h-11 rounded-none px-4")}
            href="/browse"
          >
            Back to catalogue
          </Link>
        </div>
      </div>
    </main>
  );
}
