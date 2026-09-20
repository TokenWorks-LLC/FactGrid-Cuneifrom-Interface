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
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/88">
      <div className="site-container flex min-h-16 items-center gap-5 py-2">
        <Link
          href="/"
          className="focus-ring mr-auto max-w-52 font-heading text-lg leading-5 font-semibold tracking-[-0.01em] sm:max-w-none"
        >
          {SITE.name}
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {navigationLink("/browse", "Browse")}
          {navigationLink("/about", "About")}
          <a
            className="nav-link inline-flex items-center gap-1.5"
            href={SITE.factGridOrigin}
            rel="noreferrer"
            target="_blank"
          >
            FactGrid
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        </nav>
        <AuthControl />
      </div>
      <nav
        aria-label="Primary mobile"
        className="site-container flex min-h-11 items-center gap-6 border-t border-border text-sm md:hidden"
      >
        {navigationLink("/browse", "Browse")}
        {navigationLink("/about", "About")}
        <a className="nav-link" href={SITE.factGridOrigin} rel="noreferrer" target="_blank">
          FactGrid
        </a>
      </nav>
    </header>
  );
}
