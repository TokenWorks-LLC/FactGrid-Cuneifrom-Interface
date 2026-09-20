import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";

import { SITE } from "@/config/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Purpose, sources, attribution, and contribution status for the FactGrid Cuneiform Interface.",
};

const sourceLinks = [
  { label: "FactGrid Cuneiform Project", href: SITE.factGridProjectUrl },
  { label: "FactGrid Query Service", href: SITE.factGridQueryUrl },
  { label: "Wikibase API documentation", href: "https://www.mediawiki.org/wiki/Wikibase/API" },
  { label: "MediaWiki revision documentation", href: "https://www.mediawiki.org/wiki/API:Revisions" },
];

export default function AboutPage() {
  return (
    <main id="main-content" className="site-container py-14 sm:py-20">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-20">
        <article className="reading-column">
          <h1 className="font-heading text-5xl font-medium tracking-[-0.03em] sm:text-6xl">About</h1>
          <p className="mt-7 text-xl leading-8 text-muted-foreground">
            FactGrid Cuneiform Interface is a focused way to discover and read
            cuneiform tablet records held in FactGrid.
          </p>

          <h2>Relationship to FactGrid</h2>
          <p>
            FactGrid is the authoritative source for records, document pages,
            user identity, permissions, and revision history. This application
            reads those live sources and links back to them. It is not a second
            catalogue, and it does not imply an institutional endorsement by
            FactGrid or by projects whose editions are linked from a record.
          </p>

          <h2>Text and editions</h2>
          <p>
            A tablet may have no transcript, one FactGrid document page, several
            differently formatted editions, or an external transcript link. The
            interface keeps those sources separate and identifies unsupported or
            unavailable material rather than manufacturing a single complete text.
          </p>

          <h2>Images and rights</h2>
          <p>
            FactGrid&apos;s structured data is published under CC0. Linked images
            and transcript publications can have different rights. This interface
            only embeds an image when usable rights and attribution are available;
            otherwise it provides a source link and leaves rights assessment to the
            source record.
          </p>

          <h2 id="contribution-status">Contribution status</h2>
          <p>
            Public reading does not require an account. FactGrid sign-in and
            transliteration editing are available only after a FactGrid OAuth
            consumer, an approved editor policy, and a designated test record have
            been configured and verified. Authentication alone never grants edit access.
          </p>

          <h2>Project contacts</h2>
          <p>
            The FactGrid Cuneiform Project page names Adam Anderson and Timo
            Homburg as contacts. Contact details and current project information
            should be taken from the linked FactGrid page.
          </p>
        </article>

        <aside className="border-t border-border pt-5 lg:border-t-0 lg:border-l lg:pt-1 lg:pl-8">
          <h2 className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
            Sources
          </h2>
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {sourceLinks.map((source) => (
              <li key={source.href}>
                <a
                  className="focus-ring flex min-h-12 items-center justify-between gap-3 py-3 text-sm font-medium hover:text-primary"
                  href={source.href}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.label}
                  <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
