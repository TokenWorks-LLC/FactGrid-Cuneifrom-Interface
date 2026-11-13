import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FacetSelect } from "./facet-select";
import { ReadRetryButton } from "@/components/read-retry-button";
import { isFactGridError } from "@/lib/factgrid/errors";
import type { LabeledEntity, TabletSearchPage } from "@/lib/factgrid";
import { searchTablets } from "@/lib/factgrid/server";
import { loadCatalogueIndex } from "@/lib/factgrid/catalogue-index.server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Browse tablets",
  description: "Search and filter cuneiform tablet records from FactGrid.",
};

export const dynamic = "force-dynamic";

type BrowseSearchParams = Promise<
  Record<"q" | "collection" | "findspot" | "period" | "language" | "workType" | "material" | "page" | "snapshot", string | string[] | undefined>
>;

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : (value?.[0] ?? "");
}

function pageUrl(values: Record<string, string>, page: number, snapshot?: string): string {
  const params = new URLSearchParams(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  if (page > 1) params.set("page", String(page));
  else params.delete("page");
  if (snapshot) params.set("snapshot", snapshot);
  const query = params.toString();
  return query ? `/browse?${query}` : "/browse";
}

function contextualFacetOptions(
  results: TabletSearchPage["results"],
  property: "holdings" | "findspots" | "periods" | "languages" | "workTypes" | "materials",
  selected: string,
  selectedLabel?: string,
): LabeledEntity[] {
  const options = new Map<string, LabeledEntity>();
  for (const result of results) {
    for (const value of result[property]) options.set(value.id, value);
  }
  if (/^Q[1-9][0-9]{0,14}$/u.test(selected) && !options.has(selected)) {
    options.set(selected, {
      id: selected as LabeledEntity["id"],
      label: selectedLabel || selected,
      url: `https://database.factgrid.de/wiki/Item:${selected}`,
    });
  }
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  return [...options.values()].sort(
    (left, right) =>
      collator.compare(left.label, right.label) || left.id.localeCompare(right.id),
  );
}

export default async function BrowsePage({ searchParams }: { searchParams: BrowseSearchParams }) {
  const raw = await searchParams;
  const values = {
    q: first(raw.q).trim(),
    collection: first(raw.collection).trim().toUpperCase(),
    findspot: first(raw.findspot).trim().toUpperCase(),
    period: first(raw.period).trim().toUpperCase(),
    language: first(raw.language).trim().toUpperCase(),
    workType: first(raw.workType).trim().toUpperCase(),
    material: first(raw.material).trim().toUpperCase(),
  };
  const pageValue = Number.parseInt(first(raw.page) || "1", 10);
  const page = Number.isSafeInteger(pageValue) ? Math.max(1, pageValue) : 1;

  let results;
  try {
    results = await searchTablets({
    q: values.q,
    collection: values.collection || undefined,
    findspot: values.findspot || undefined,
    period: values.period || undefined,
    language: values.language || undefined,
    workType: values.workType || undefined,
    material: values.material || undefined,
    page,
    catalogueVersion: first(raw.snapshot) || undefined,
    });
  } catch (error) {
    if (!isFactGridError(error)) throw error;
    const invalid = error.code === "INVALID_INPUT";
    return (
      <main className="site-container py-16" id="main-content">
        <h1 className="font-heading text-4xl font-medium">{invalid ? "Search could not be applied" : "Catalogue search is unavailable"}</h1>
        <p className="mt-4 max-w-[65ch] leading-7 text-muted-foreground">
          {invalid ? error.message : "The source request did not complete or could not be validated. This does not mean there are no matching tablets."}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-5">
          {error.retryable ? <ReadRetryButton label="Try again" /> : null}
          <Link className="focus-ring inline-flex min-h-11 items-center text-sm underline" href="/browse">Reset the search</Link>
        </div>
      </main>
    );
  }
  const index = await loadCatalogueIndex();
  const facets = {
    collections: contextualFacetOptions(results.results, "holdings", values.collection, index?.labels[values.collection]),
    findspots: contextualFacetOptions(results.results, "findspots", values.findspot, index?.labels[values.findspot]),
    periods: contextualFacetOptions(results.results, "periods", values.period, index?.labels[values.period]),
    languages: contextualFacetOptions(results.results, "languages", values.language, index?.labels[values.language]),
    workTypes: contextualFacetOptions(results.results, "workTypes", values.workType, index?.labels[values.workType]),
    materials: contextualFacetOptions(results.results, "materials", values.material, index?.labels[values.material]),
  };

  const hasFilters = Object.values(values).some(Boolean);

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
                key={`collection-${values.collection}`}
                label="Collection / holding"
                searchLabel="Find more holdings by name"
                name="collection"
                options={facets.collections}
                value={values.collection}
              />
              <FacetSelect
                key={`findspot-${values.findspot}`}
                label="Finding spot"
                searchLabel="Find more finding spots by name"
                name="findspot"
                options={facets.findspots}
                value={values.findspot}
              />
              <FacetSelect
                key={`period-${values.period}`}
                label="Period / style"
                searchLabel="Find more periods by name"
                name="period"
                options={facets.periods}
                value={values.period}
              />
              <FacetSelect
                key={`language-${values.language}`}
                label="Language"
                searchLabel="Find more languages by name"
                name="language"
                options={facets.languages}
                value={values.language}
              />
              <FacetSelect
                key={`workType-${values.workType}`}
                label="Type of work"
                searchLabel="Find more types of work by name"
                name="workType"
                options={facets.workTypes}
                value={values.workType}
              />
              <FacetSelect
                key={`material-${values.material}`}
                label="Material"
                searchLabel="Find more materials by name"
                name="material"
                options={facets.materials}
                value={values.material}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Search each filter by label or QID, choose a value, then apply the search.
                Large lists have their own value pages; your selection stays selected while browsing them.
              </p>

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
                Page {results.page}.
                {results.catalogue?.source === "snapshot"
                  ? ` ${results.catalogue.totalResults?.toLocaleString("en") ?? "Matching"} indexed records. Stable QID order.`
                  : " FactGrid’s live index may change between visits."}
              </p>
            </div>
            {hasFilters ? <Badge variant="outline">Filtered</Badge> : null}
          </div>

          <p className="border-b border-border py-4 text-sm leading-6 text-muted-foreground" role="status">
            {results.catalogue?.complete
              ? `Catalogue-wide discovery index refreshed ${results.catalogue.generatedAt ? new Date(results.catalogue.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC" : "at an unavailable timestamp"}. Record details are checked live; later source changes appear after the next refresh.`
              : "Catalogue-wide discovery is unavailable. Live search has a provider limit of 10,000 results; filter name suggestions may include unrelated entities. Direct tablet URLs remain available."}
          </p>

          {results.catalogue?.restarted ? (
            <p className="border-b border-border bg-secondary/40 p-4 text-sm leading-6" role="status">
              The catalogue was refreshed. Showing page 1 with your search and filters so you can continue through the updated results.
            </p>
          ) : null}

          {results.results.length === 0 ? (
            <div className="border-b border-border py-14">
              <h3 className="font-heading text-2xl font-medium">No matching tablets</h3>
              <p className="mt-3 max-w-[58ch] leading-7 text-muted-foreground">
                No current tablet was returned on this page. Try fewer filters, a shorter identifier, or the previous page. The discovery index can briefly retain records changed in FactGrid.
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
                          href={`/tablets/${tablet.qid}?returnTo=${encodeURIComponent(pageUrl(values, results.page, results.catalogue?.generatedAt))}`}
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
                        <ResultFact label="Inventory" values={tablet.inventoryNumbers} />
                        <ResultFact label="CDLI" values={tablet.cdliIds} />
                      </dl>
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:justify-between">
                      <Link
                        aria-label={`Open ${tablet.title}`}
                        className="focus-ring inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline decoration-primary/35 underline-offset-4 hover:decoration-primary"
                        href={`/tablets/${tablet.qid}?returnTo=${encodeURIComponent(pageUrl(values, results.page, results.catalogue?.generatedAt))}`}
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
                href={pageUrl(values, results.page - 1, results.catalogue?.generatedAt)}
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
                href={pageUrl(values, results.page + 1, results.catalogue?.generatedAt)}
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

function ResultFact({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="font-medium text-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-muted-foreground">{values.join(", ")}</dd>
    </div>
  );
}
