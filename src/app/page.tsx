import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpenText, ExternalLink, Search } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SITE } from "@/config/site";
import { cn } from "@/lib/utils";

const tabletImage =
  "https://commons.wikimedia.org/wiki/Special:Redirect/file/Cuneiforme_tablet_and_enveloppe-MAHG_16161-IMG_9474.JPG?width=900";
const tabletFilePage =
  "https://commons.wikimedia.org/wiki/File:Cuneiforme_tablet_and_enveloppe-MAHG_16161-IMG_9474.JPG";

export default function Home() {
  return (
    <main id="main-content">
      <section className="hero-surface overflow-hidden border-b border-border">
        <div className="site-container grid min-h-[38rem] gap-12 py-16 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end lg:py-24">
          <div className="max-w-4xl">
            <h1 className="balance max-w-[12ch] font-heading text-5xl leading-[0.98] font-medium tracking-[-0.03em] text-foreground sm:text-6xl lg:text-[5.4rem]">
              Read the record. Follow the source.
            </h1>
            <p className="mt-7 max-w-[58ch] text-lg leading-8 text-muted-foreground sm:text-xl">
              Search FactGrid&apos;s cuneiform catalogue, inspect tablet metadata,
              and compare the editions and source links that are actually available.
            </p>

            <form
              action="/browse"
              className="mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row"
              role="search"
            >
              <label className="sr-only" htmlFor="home-search">
                Search tablets by name, QID, or identifier
              </label>
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="home-search"
                  name="q"
                  placeholder="Tablet name, QID, or CDLI identifier"
                  className="h-14 rounded-none border-foreground/25 bg-background pl-12 text-base shadow-none"
                />
              </div>
              <Button className="h-14 rounded-none px-7" type="submit">
                Search catalogue
                <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
            </form>

            <Link
              href="/browse"
              className="focus-ring mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline decoration-primary/35 underline-offset-4 hover:decoration-primary"
            >
              Browse tablets
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>

          <figure className="relative min-h-[25rem] overflow-hidden border border-foreground/15 bg-[#6d5a43] text-white sm:min-h-[31rem]">
            <Image
              alt="A cuneiform tablet and its clay envelope in the Museum of Art and History, Geneva"
              className="object-cover"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 352px"
              src={tabletImage}
            />
            <div className="absolute inset-x-0 bottom-0 bg-[#201b16]/90 p-5">
              <figcaption className="text-sm leading-5">
                Cuneiform tablet and envelope, MAHG 16161.
              </figcaption>
              <a
                className="focus-ring mt-2 inline-flex text-xs text-[#eee5d8] underline decoration-[#eee5d8]/50 underline-offset-4 hover:decoration-[#eee5d8]"
                href={tabletFilePage}
                rel="license noreferrer"
                target="_blank"
              >
                Photograph: Rama · CC BY-SA 3.0 FR
              </a>
            </div>
          </figure>
        </div>
      </section>

      <section className="site-container py-16 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <h2 className="max-w-[14ch] font-heading text-3xl leading-tight font-medium tracking-[-0.02em] sm:text-4xl">
              A careful route through a complex catalogue
            </h2>
            <p className="mt-5 max-w-[45ch] leading-7 text-muted-foreground">
              FactGrid remains the authority. This interface makes its tablet
              records easier to discover and read without flattening different
              editions into one transcript.
            </p>
          </div>

          <ol className="border-t border-border">
            <li className="grid gap-3 border-b border-border py-6 sm:grid-cols-[8rem_1fr] sm:gap-8">
              <span className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">Catalogue</span>
              <div>
                <h3 className="font-heading text-2xl font-medium">Locate a catalogue record</h3>
                <p className="mt-2 max-w-[60ch] leading-7 text-muted-foreground">
                  Search names, FactGrid QIDs, and supported identifiers. Narrow
                  results by current holding, findspot, or period when the data is recorded.
                </p>
              </div>
            </li>
            <li className="grid gap-3 border-b border-border py-6 sm:grid-cols-[8rem_1fr] sm:gap-8">
              <span className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">Witnesses</span>
              <div>
                <h3 className="font-heading text-2xl font-medium">Keep editions distinct</h3>
                <p className="mt-2 max-w-[60ch] leading-7 text-muted-foreground">
                  Inspect identifiers, physical description, provenance, holding,
                  language, and text witnesses—while seeing omissions plainly.
                </p>
              </div>
            </li>
            <li className="grid gap-3 border-b border-border py-6 sm:grid-cols-[8rem_1fr] sm:gap-8">
              <span className="font-mono text-xs tracking-[0.1em] text-muted-foreground uppercase">Provenance</span>
              <div>
                <h3 className="font-heading text-2xl font-medium">Verify in FactGrid</h3>
                <p className="mt-2 max-w-[60ch] leading-7 text-muted-foreground">
                  Every record and edition keeps a route back to FactGrid or its
                  external source, where provenance and revision history belong.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="border-y border-border bg-secondary/55">
        <div className="site-container grid gap-8 py-12 md:grid-cols-[1fr_auto] md:items-center">
          <div className="flex gap-4">
            <BookOpenText aria-hidden="true" className="mt-1 size-6 shrink-0 text-primary" />
            <div>
              <h2 className="font-heading text-2xl font-medium">Start with a documented example</h2>
              <p className="mt-2 max-w-[60ch] leading-7 text-muted-foreground">
                Prag I 437 is a FactGrid tablet record with several linked textual
                editions—useful for seeing how sources remain distinct.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className={cn(buttonVariants(), "min-h-11 rounded-none px-4")} href="/tablets/Q499899">
              Open tablet record
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <a
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11 rounded-none px-4")}
              href={SITE.factGridExampleUrl}
              rel="noreferrer"
              target="_blank"
            >
              View in FactGrid
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
