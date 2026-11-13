# Catalogue discovery and pagination evidence

Investigation date: 13 November 2026. This is the catalogue workstream's evidence;
the coordinated handoff records final validation and deployment status.

## Observed provider behavior

Read-only requests used the fixed FactGrid Action API and SPARQL endpoints with
the application's identifying user agent and redirects disabled.

- `action=query&list=search&srnamespace=120&srsearch=haswbstatement:P2=Q512006`
  reported **152,640** indexed results. A two-result first-page request took
  **4,277 ms** in this session.
- The same query with `sroffset=10000` returned
  `cirrussearch-offset-too-large`, explicitly reporting a 10,000-result limit.
  Offset 50,000 returned the same error. `paraminfo` does not advertise this
  backend restriction, so removing the UI's 100-page limit alone cannot expose
  the complete catalogue.
- Adding `haswbstatement:P329=Q512014` returned two results in **368 ms**.
- SPARQL counting active, non-deprecated P2 statements reported **152,633**
  records at scan start. RDF and Cirrus counts differ; an index count is not
  evidence that every index entry still has the same authoritative statements.
- A sorted keyset SPARQL query returning 500 IDs took **4,409 ms**, 61,585 bytes.
- A projected aggregate metadata query for 500 IDs took **632 ms**, 608,915
  bytes in a separate measurement. The prior unaggregated representation was
  about 1.7 MB. A resumed 1,000-record batch, including startup closure/count
  checks, used four requests, **11,443 ms**, and **1,319,960 bytes**.

These are individual observations, not latency guarantees. The complete scan's
final count, interval and artifact size must be recorded after it finishes.

## Inclusion and discovery contracts

`eligibility.ts` owns the reviewed class list and policy version. Live evidence
currently supports Q512006 (Clay tablet), and the verified P3 subclass closure
contained only that class. No guessed alternative class or individual tablet
allowlist was added. The generator refuses to run when the live closure differs
from the reviewed class list.

Discovery uses full P2 statements with ranks other than `DeprecatedRank`, rather
than only truthy `wdt:P2`, so a normal valid statement is not hidden by a preferred
statement. IDs are strictly ordered by their complete URI, with a greater-than
keyset boundary. Each response is bounded to at most 1,000 IDs. Metadata uses
bounded `VALUES` queries and aggregates only discovery terms and six facet QIDs.
The snapshot contains labels, aliases, titles (P11), direct identifiers (P10,
P692), holding inventory qualifiers (P329/pq:P10), and collection, findspot,
period, language, work type and material IDs. No edition text, source document,
image or editable entity snapshot is copied into this artifact.

“Complete” means that the configured keyset scan exhausted this verified policy,
and the start count, final count and distinct scanned ID count agree. FactGrid
does not provide a transaction spanning these requests: equal-count membership
swaps and edits during the scan remain possible. The scan interval is exposed
through `startedAt` and `generatedAt`; this is not a claim of an atomic global
snapshot. Page entities and selected facet values are checked against the
authoritative live API again before display. A stale entry leaves a hole instead
of pulling a later item forward and duplicating it on the next page.

## Operating the index

Run from the repository root using Node 22 or newer:

```text
npm run catalogue:refresh -- --classes Q512006 --policy clay-tablet-p2-p3-v1 --batch-size 1000 --max-batches 20
```

On Windows shells with execution-policy restrictions use `npm.cmd`. Repeating
the command resumes `.data/catalogue-index.json.checkpoint`. Each invocation is
bounded; `--max-batches 1000` permits a full initial scan in one invocation. An
interrupted or failed batch leaves the prior checkpoint and published artifact
intact. The initial scan must finish before deployment can offer catalogue-wide
filter completeness and deep pagination.

`--output` selects an artifact path. `FACTGRID_CATALOGUE_INDEX` selects that file
for the application; its default is `.data/catalogue-index.json`. The directory
is already ignored by Git. Deploy/mount the finished artifact separately; the
Next build deliberately does not bundle an operator-managed local index.

Publication validates ordered unique IDs, field types, size bounds, counts,
policy and dates, then atomically renames a unique temporary file. An exclusive
`.lock` prevents competing generators for the same output. If a process is killed
without cleanup, inspect the lock's PID and verify that process has exited before
manually removing the stale lock. Do not delete a lock belonging to a running
refresh. Malformed checkpoints are rejected; archive them and begin a new full
scan after investigating their origin.

The checkpoint remains after completion. Re-running an exhausted checkpoint can
enrich aliases or resume an explicit format migration, but preserves the original
completion date. To obtain a fresh catalogue, archive the completed checkpoint
and run a new scan; do not mistake an exhausted rerun for a full refresh. Retain
the existing published index throughout that scan. No scheduler or external
service is required; operators can schedule the same command outside visitor
requests at a cadence appropriate to their update rate. Every resulting artifact
displays its actual completion date; there is no implied automatic freshness SLA.

The loader checks file size (64 MB maximum), version, policy, fields and ordering,
and retains its last valid in-process index if a replacement is malformed or
unavailable. A cold process without a valid index explicitly reports incomplete
live-search mode. That fallback can search only the provider's first 10,000
results and offers general FactGrid name matches rather than pretending to have
complete catalogue facets. Deep live offsets fail with an actionable setup
message instead of a misleading empty result.

## Search and facet behavior

All selected filters apply before snapshot pagination. IDs remain in stable
lexicographic QID order within a snapshot. A replacement snapshot can naturally
change page contents; bookmarked page numbers are not immutable historical
cursors. Text search is case-insensitive literal matching over discovery labels,
aliases and identifiers, not over scholarly edition text.

Integration adds a generation timestamp to pagination links. A different current
index restarts the same search and filters at page one with an explicit notice;
it does not silently continue across changed page boundaries. Record return
links also preserve the filtered browse URL.

`/api/facets?property=collection&q=Jena&offset=0` returns at most 50 results,
`total`, `nextOffset`, `complete`, and `generatedAt`. It supports all six facet
names. Complete distinct facet lists are derived from the entire snapshot,
deduplicated by QID and sorted by readable label. Alternate-language labels and
source aliases are searchable; missing labels retain the QID and FactGrid link.
The UI can page through every match instead of loading thousands of native
options or silently truncating them. Filter state stays in URLs.

WeakMap caches retain normalized text and facet lists per immutable index object.
A local synthetic benchmark of 152,633 rows, sampling discovery metadata from an
in-progress 47,000-row live checkpoint, measured general query 31.71 ms,
collection filter 26.93 ms, period filter 28.58 ms, cold text search 166.78 ms,
warm text search 24.63 ms, cold facet lookup 17.84 ms and warm facet lookup
0.08 ms. These exclude live entity requests and are synthetic local measurements,
not production end-to-end results.

## Verification from this workstream

The focused pre-change search-query and validation baseline passed nine tests.
The new catalogue tests cover policy/shape validation, rejected partial indexes,
duplicate IDs, non-string coerced IDs/dates, off-page facets, missing labels,
large facet lists, aliases, combined six-facet matching, normalized page 101,
authoritative server integration, safe page arithmetic, provider deep-offset
failure, missing artifacts, last-known-good replacement handling, and a spawned
mock-provider generator's interrupted refresh, resumed completion, writer lock,
malformed checkpoint and preserved completion timestamp.

The final focused run passed **23 tests in four files**. Focused ESLint passed;
the repository typecheck passed at that point. The coordinating agent owns the
final full lint, test, browser, build, release-artifact and deployment results.

## Coordinated completed-artifact measurements

The final artifact enumerates 152,633 records, with 100 holding values, 171
finding spots, 32 periods, 7 languages, 52 work types and 9 materials. It is
57,301,503 bytes (5,504,908 bytes gzipped). Its scan interval is
07:49:15.905–08:21:05.072 UTC on 13 November 2026, including implementation pauses,
one source timeout/resume and checkpoint metadata upgrades. This wall interval
is not a steady-state refresh benchmark. The coordinator separately verified why
the earlier truthy holding count was 99; see `data-evidence.md`.

Seven-sample median local queries on that actual artifact: general 14.70 ms,
holding Q21880 44.95 ms, period Q512142 59.32 ms, warm HS 751 text search
31.30 ms, page 501 18.11 ms, warm finding-spot lookup 0.35 ms. JSON parsing plus
validation took 492.50 ms once. These exclude authoritative API reads and were
measured on the current Windows Node 24 host with other validation running.

The local production build returned HTTP 200 for HS 751 with visible ATF
(872.6 ms), pages 501/502 (1,349.7/568.5 ms, twenty disjoint records each),
combined holding/period filters (747.5 ms), and three property-specific facet
lookups (62.5–79.6 ms). These are individual observations, not latency promises.
