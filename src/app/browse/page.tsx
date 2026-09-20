import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LabeledEntity, TabletFacets } from "@/lib/factgrid";
import { getTabletFacets, searchTablets } from "@/lib/factgrid/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Browse tablets",
  description: "Search and filter cuneiform tablet records from FactGrid.",
};

export const dynamic = "force-dynamic";

type BrowseSearchParams = Promise<
  Record<"q" | "collection" | "findspot" | "period" | "page", string | string[] | undefined>
>;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : (value?.[0] ?? "");
}

function selectOptions(options: LabeledEntity[]) {
  return options.map((option) => (
    <option key={option.id} value={option.id}>
      {option.label} ({option.id})
    </option>
  ));
}

function pageUrl(values: Record<string, string>, page: number): string {
  const params = new URLSearchParams(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  if (page > 1) params.set("page", String(page));
  else params.delete("page");
  const query = params.toString();
  return query ? `/browse?${query}` : "/browse";
}

export default async function BrowsePage({ searchParams }: { searchParams: BrowseSearchParams }) {
  const raw = await searchParams;
  const values = {
    q: first(raw.q).trim(),
    collection: first(raw.collection).trim(),
    findspot: first(raw.findspot).trim(),
    period: first(raw.period).trim(),
  };
  const pageValue = Number.parseInt(first(raw.page) || "1", 10);
  const page = Number.isSafeInteger(pageValue) ? Math.min(100, Math.max(1, pageValue)) : 1;

  const [results, facetResult] = await Promise.all([
    searchTablets({
      q: values.q,
      collection: values.collection || undefined,
      findspot: values.findspot || undefined,
      period: values.period || undefined,
      page,
    }),
    getTabletFacets()
      .then((facets) => ({ facets, unavailable: false as const }))
      .catch(() => ({
        facets: { collections: [], findspots: [], periods: [] } satisfies TabletFacets,
        unavailable: true as const,
      })),
  ]);

  const hasFilters = Boolean(values.q || values.collection || values.findspot || values.period);

  return (
    <main id="main-content" className="site-container py-12 sm:py-16">
      <div className="grid gap-10 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-14">
        <aside>
          <div className="lg:sticky lg:top-28">
            <h1 className="font-heading text-4xl font-medium tracking-[-0.025em]">Browse tablets</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Search is limited to records identified in FactGrid as clay tablets before results are paginated.
            </p>

            <form action="/browse" className="mt-7 space-y-5" role="search">
              <div>
                <label className="text-sm font-medium" htmlFor="catalogue-query">
                  Name or identifier
                </label>
                <div className="relative mt-2">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    className="h-11 rounded-none pl-10 shadow-none"
                    defaultValue={values.q}
                    id="catalogue-query"
                    maxLength={100}
                    name="q"
                    placeholder="Prag I 437 or Q499899"
                  />
                </div>
              </div>

              <FacetSelect
                label="Collection / holding"
                name="collection"
                options={facetResult.facets.collections}
                value={values.collection}
              />
              <FacetSelect
                label="Finding spot"
                name="findspot"
                options={facetResult.facets.findspots}
                value={values.findspot}
              />
              <FacetSelect
                label="Period / style"
                name="period"
                options={facetResult.facets.periods}
                value={values.period}
              />

              {facetResult.unavailable ? (
                <p className="text-sm leading-5 text-muted-foreground">
                  Filter lists are temporarily unavailable. Text search still works.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button className="min-h-11 flex-1 rounded-none px-4" type="submit">
                  Apply search
                </Button>
                {hasFilters ? (
                  <Link
                    className={cn(buttonVariants({ variant: "outline" }), "min-h-11 rounded-none px-3")}
                    href="/browse"
                  >
                    Clear
                  </Link>
                ) : null}
              </div>
            </form>
          </div>
        </aside>

        <section aria-labelledby="results-title">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-foreground/35 pb-4">
            <div>
              <h2 id="results-title" className="font-heading text-3xl font-medium">
                {values.q ? `Results for “${values.q}”` : "Catalogue records"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Page {results.page}. FactGrid&apos;s live index may change between visits.
              </p>
            </div>
            {hasFilters ? <Badge variant="outline">Filtered</Badge> : null}
          </div>

          {results.results.length === 0 ? (
            <div className="border-b border-border py-14">
              <h3 className="font-heading text-2xl font-medium">No matching tablets</h3>
              <p className="mt-3 max-w-[58ch] leading-7 text-muted-foreground">
                FactGrid answered successfully, but no current catalogue record matched this combination. Try fewer filters or a shorter identifier.
              </p>
              <Link className="focus-ring mt-5 inline-flex min-h-11 items-center font-medium underline underline-offset-4" href="/browse">
                Reset the search
              </Link>
            </div>
          ) : (
            <ol>
              {results.results.map((tablet) => (
                <li key={tablet.qid} className="border-b border-border py-7">
                  <article className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <Link
                          className="focus-ring font-heading text-2xl font-medium decoration-primary/35 underline-offset-4 hover:underline"
                          href={`/tablets/${tablet.qid}`}
                        >
                          {tablet.title}
                        </Link>
                        <span className="font-mono text-xs text-muted-foreground">{tablet.qid}</span>
                      </div>
                      {tablet.description ? (
                        <p className="mt-2 max-w-[68ch] leading-7 text-muted-foreground">{tablet.description}</p>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">No description recorded in FactGrid.</p>
                      )}
                      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                        <ResultFact label="Holding" values={tablet.holdings.map((value) => value.label)} />
                        <ResultFact label="Findspot" values={tablet.findspots.map((value) => value.label)} />
                        <ResultFact label="Period" values={tablet.periods.map((value) => value.label)} />
                        <ResultFact label="CDLI" values={tablet.cdliIds} />
                      </dl>
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:justify-between">
                      <Link
                        aria-label={`Open ${tablet.title}`}
                        className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline decoration-primary/35 underline-offset-4 hover:decoration-primary"
                        href={`/tablets/${tablet.qid}`}
                      >
                        Read record
                        <ArrowRight aria-hidden="true" className="size-4" />
                      </Link>
                      <a
                        className="focus-ring inline-flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                        href={tablet.factGridUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        FactGrid
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          )}

          <nav aria-label="Search result pages" className="mt-8 flex justify-between gap-4">
            {results.page > 1 ? (
              <Link
                className={cn(buttonVariants({ variant: "outline" }), "min-h-11 rounded-none px-4")}
                href={pageUrl(values, results.page - 1)}
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                Previous
              </Link>
            ) : (
              <span />
            )}
            {results.hasNextPage ? (
              <Link
                className={cn(buttonVariants({ variant: "outline" }), "min-h-11 rounded-none px-4")}
                href={pageUrl(values, results.page + 1)}
              >
                Next
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
          </nav>
        </section>
      </div>
    </main>
  );
}

function FacetSelect({
  label,
  name,
  options,
  value,
}: {
  label: string;
  name: string;
  options: LabeledEntity[];
  value: string;
}) {
  return (
    <div>
      <label className="text-sm font-medium" htmlFor={`facet-${name}`}>
        {label}
      </label>
      <select
        className="mt-2 min-h-11 w-full border border-input bg-background px-3 text-sm"
        defaultValue={value}
        disabled={options.length === 0}
        id={`facet-${name}`}
        name={name}
      >
        <option value="">Any</option>
        {selectOptions(options)}
      </select>
    </div>
  );
}

function ResultFact({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="font-medium text-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-muted-foreground">{values.join(", ")}</dd>
    </div>
  );
}
