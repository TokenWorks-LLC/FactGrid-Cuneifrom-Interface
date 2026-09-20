"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { SITE } from "@/config/site";
import { cn } from "@/lib/utils";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the opaque Next digest only; upstream responses and credentials stay out.
    if (error.digest) console.error("Page failed", { digest: error.digest });
  }, [error.digest]);

  return (
    <main id="main-content" className="site-container py-20">
      <div className="max-w-2xl border-y border-border py-10">
        <AlertTriangle aria-hidden="true" className="size-8 text-primary" />
        <h1 className="mt-6 font-heading text-4xl font-medium tracking-[-0.025em]">
          This page could not be loaded
        </h1>
        <p className="mt-4 max-w-[58ch] leading-7 text-muted-foreground">
          The request did not complete. A source service may be busy, or the
          application may have encountered an unexpected problem. Try again, or
          return to a public page.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Button className="min-h-11 rounded-none px-4" onClick={reset} type="button">
            <RotateCcw aria-hidden="true" className="size-4" />
            Try again
          </Button>
          <a
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11 rounded-none px-4")}
            href={SITE.factGridOrigin}
            rel="noreferrer"
            target="_blank"
          >
            Open FactGrid
          </a>
          <Link
            className={cn(buttonVariants({ variant: "ghost" }), "min-h-11 rounded-none px-4")}
            href="/"
          >
            Return home
          </Link>
        </div>
      </div>
    </main>
  );
}
