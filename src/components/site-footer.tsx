import Link from "next/link";

import { SITE } from "@/config/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-[#292722] text-[#f3efe6]">
      <div className="site-container grid gap-8 py-10 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="font-heading text-xl font-medium">{SITE.name}</p>
          <p className="mt-3 max-w-[55ch] text-sm leading-6 text-[#d2cbc0]">
            A focused reading interface. Records, identity, and revision history remain in FactGrid.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          <Link className="footer-link" href="/about">
            About &amp; sources
          </Link>
          <a className="footer-link" href={SITE.sourceCodeUrl} rel="noreferrer" target="_blank">
            Source code
          </a>
          <a className="footer-link" href={SITE.factGridProjectUrl} rel="noreferrer" target="_blank">
            FactGrid project
          </a>
        </div>
      </div>
    </footer>
  );
}
