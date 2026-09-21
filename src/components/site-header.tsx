"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { usePathname } from "next/navigation";

import { AuthControl } from "@/components/auth-control";
import { SITE } from "@/config/site";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const pathname = usePathname();

  function navigationLink(href: string, label: string) {
    const current = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        aria-current={current ? "page" : undefined}
        className={cn(
          "nav-link",
          current && "text-foreground underline decoration-primary/50 underline-offset-4",
        )}
        href={href}
      >
        {label}
      </Link>
    );
  }

  return (
    <header className="relative z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/88 lg:sticky lg:top-0">
      <div className="site-container grid grid-cols-1 gap-2 py-2 lg:min-h-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-5">
        <Link
          href="/"
          className="focus-ring inline-flex min-h-11 max-w-52 items-center font-heading text-lg leading-5 font-semibold tracking-[-0.01em] sm:max-w-none lg:min-h-0"
        >
          {SITE.name}
        </Link>
        <nav
          aria-label="Primary"
          className="flex flex-col items-stretch gap-2 border-t border-border pt-2 text-sm lg:flex-row lg:items-center lg:gap-6 lg:border-t-0 lg:pt-0"
        >
          <div className="flex min-h-11 items-center justify-between gap-5 lg:min-h-0 lg:gap-6">
            {navigationLink("/browse", "Browse")}
            {navigationLink("/about", "About")}
            <a
              className="nav-link inline-flex items-center gap-1.5"
              href={SITE.factGridOrigin}
              rel="noreferrer"
              target="_blank"
            >
              FactGrid
              <ExternalLink aria-hidden="true" className="hidden size-3.5 lg:block" />
            </a>
          </div>
          <AuthControl />
        </nav>
      </div>
    </header>
  );
}
