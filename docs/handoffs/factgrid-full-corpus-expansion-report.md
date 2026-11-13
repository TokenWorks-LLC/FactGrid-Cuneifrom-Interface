# FactGrid corpus expansion and reliability handoff

Date: 13 November 2026. All live FactGrid requests were read-only.

## A. Executive outcome

Implementation and locally available verification are complete. The interface
now has full-scan discovery under its verified tablet policy, catalogue-wide
searchable facets, deep pagination, isolated optional-read failures, and read-only
ATF support. University deployment is separately managed and must be verified
after operator release; a repository push is not deployment evidence.

Work started from clean `main`, fast-forwarded to `409fed8510199215673712bf6d363b7b92225026`.
The upstream branch was re-fetched before delivery and had not advanced. Six
specialists covered data, loading, discovery, scholarly formats, frontend and
security/QA in overlapping waves within the three-worker concurrency limit.
Shared eligibility, edition-error, ATF and index contracts preceded integration.
Only the coordinator prepares the final commit and single push; no worker pushed,
opened a PR, deployed, or changed live scholarly data.

## B. Q894483 root cause and evidence

The live API returned HS 751, revision 20736312, with active `P2=Q512006`.
Q512006 means **Clay tablet**, not Old Assyrian. The existing membership predicate
already accepts this item. The reported historical 404 was not reproduced:
production returned HTTP 200 in 274 ms during baseline inspection.

The confirmed defect was edition recognition. Active P251 statement
`Q894483$0ACD95A8-BDFF-4584-BE3C-7104AB8745D0` explicitly links
`CDLI-ATF-L-Q894483`; revision 20109826 is wikitext with one unheaded ATF poem.
The old parser displayed “no supported transliteration region was recognized.”
The new exact-family parser recognizes that source and preserves its poem content
verbatim. Its sole linked statement corresponds to `#edition-1`.

Holding/findspot/period/language are Q21880/Q390017/Q512142/Q471149. The holding
claim is the Jena institution; no inferred replacement collection was added.
Captured API fixtures retain the actual item/document revisions. Live browser
and local production-build checks both rendered HS 751 with readable ATF.

Sources: [item](https://database.factgrid.de/wiki/Item:Q894483),
[edition](https://database.factgrid.de/wiki/CDLI-ATF-L-Q894483),
[detailed evidence](data-evidence.md).

## C. Corpus coverage

The policy `clay-tablet-p2-p3-v1` accepts item entities with at least one active,
non-deprecated P2 statement in the verified Q512006 subclass closure. A bounded
live P3 closure query returned only Q512006. All six comparison records share
that class. No verified alternative classification or unclassified ATF-linked
pattern justified a speculative additional inclusion rule.

Read and edit predicates are separate. Search, index generation and direct reads
agree on the verified policy; direct reads do not require index membership.
Unrelated, missing, deprecated-only and non-item entities are rejected. Future
classes require evidence, a policy update, and regeneration. Labels, inventory
numbers, materials and guessed document titles never establish membership.

The completed scan enumerated **152,633 IDs**, agreeing with start/end source
counts, over `2026-11-13T07:49:15.905Z`–`2026-11-13T08:21:05.072Z`. Its
completeness means exhausted enumeration under this policy during that interval.
RDF is not transactionally frozen, and API/RDF/search indexes can lag. Equal
counts cannot exclude balanced source changes. Cirrus separately reported
152,640 hits. Unknown differently modelled tablets remain an explicit coverage
gap rather than being admitted through weak heuristics.

## D. Collections, finding spots and periods

The real artifact contains the following non-deprecated statement values:

| Facet | Distinct QIDs | Records with a value |
|---|---:|---:|
| Holding / collection | 100 | 107,279 |
| Finding spot | 171 | 127,791 |
| Period / style | 32 | 140,313 |
| Language | 7 | 125,390 |
| Work type | 52 | 135,243 |
| Material | 9 | 147,281 |

The earlier truthy aggregate found 99 holdings. A bounded follow-up confirmed the
extra Q1350403 is a normal-rank holding alongside a preferred holding on Q1350401.
The app retains both active statements, consistently with its adapters; the
truthy RDF view retains only preferred values when present.

All options come from the whole completed artifact, are deduplicated by QID, and
search labels, alternate-language names and aliases. Missing labels retain a
linked QID. The API and native controls page through fifty values at a time,
retaining a selected off-page value. Direct URLs, combined filters, keyboard
operation, reset controls and desktop/mobile layouts are covered.

The generator uses bounded keyset discovery and projected metadata, resumable
validated checkpoints, writer exclusion, unique temporary files and atomic
publication. A failed refresh retains the publication; the runtime retains its
last valid index. Exhausted reruns preserve the original freshness date. A new
refresh archives the completed checkpoint first. Weekly/after-import refresh is
the documented operator policy; no scheduler or external infrastructure was
installed. No visitor request runs a global facet scan.

See [Operations](../operations.md#catalogue-discovery-index) for exact commands,
lock recovery, source changes, file bounds and Docker mounts.

## E. Editions and ATF

Existing D, CDLI-W, ORACC-W and Unicode editions remain supported with their prior
format restrictions. Exact trusted `CDLI-ATF-L-Q{qid}` pages now receive an ATF
label and conservative single-poem recognition. Identification/directives are
required; ambiguous, malformed or unsupported layouts are not guessed.

ATF rendering is escaped React text and bypasses wikitext simplification.
Whitespace, line breaks, directives, text markers, brackets and notation remain
unchanged. Every edition keeps its own source, revision and timestamp. Failed
editions retain numbering and anchors; deep links open the intended disclosure.
No candidate title is fetched unless P251 explicitly links it. External P69
sources are never scraped or imported.

ATF is always read-only, including when an authorized contributor enables a
matching target. Only the established verified plain D-region contract may be
spliced. Existing unsupported formats remain read-only.

## F. Reliability, pagination and performance

Core entity failures remain distinct from missing or ineligible records. Optional
labels fall back to linked QIDs with a warning. Missing, unsupported, malformed,
oversized, timed-out and unavailable editions receive separate states while
metadata and other valid editions remain visible. Null/array API roots, duplicate
revision titles and invalid revision timestamps are explicit protocol errors.

Network origins, redirect refusal, timeouts, byte limits, batch sizes and the
twelve-edition read cap remain bounded. Optional reads are uncached for meaningful
manual retries; pending controls prevent duplicate clicks. There is no automatic
retry loop. One batch transport failure can affect every edition in that batch.

Index search applies all filters before strict QID pagination. Pages 501/502 in
the actual index returned twenty disjoint records each. Pagination links carry a
generation timestamp; an intervening refresh restarts page one with the same
filters and a notice. Record back-links restore the filtered browse URL. Stale
API entries leave bounded holes rather than borrowing and repeating later items.

Without a complete index, the interface reports limited live search and general
name suggestions. MediaWiki rejects offsets at 10,000; the old page-100 cap was
removed, and provider exhaustion is not confused with a provider error. Full deep
navigation requires the discovery artifact.

Measurements, with no claim of production latency guarantees:

| Measurement | Observed |
|---|---:|
| Baseline Cirrus general query (two hits) | 4,277 ms |
| Baseline collection-filtered query | 368 ms |
| Actual index parse + validation | 492.50 ms |
| Actual index median general / holding / period query | 14.70 / 44.95 / 59.32 ms |
| Actual index median warm text / warm facet lookup | 31.30 / 0.35 ms |
| Local production HTTP HS 751 | 872.6 ms |
| Local production HTTP page 501 / 502 | 1,349.7 / 568.5 ms |
| Local production HTTP combined holding + period | 747.5 ms |
| Local production HTTP facet lookups | 62.5–79.6 ms |

Index medians use seven local samples on Windows Node 24. HTTP timings are single
observations including authoritative reads; cache conditions were not isolated.
They are different workloads from the baseline. The 31m49s scan interval includes
development pauses, timeout recovery and old-checkpoint upgrades; it is not a
steady-state refresh benchmark.

## G. Security and editing

No editing permission was expanded. Editable-entity membership retains the legacy
exact class, independently of readable eligibility. OAuth sessions, fresh provider
identity, blocks, rights, grants, contributor policy, CSRF/origin checks, rate
limits, target allowlists, current P251 linkage, revision conflicts and readback
confirmation remain enforced. Partial reads and index presence never authorize a
write. No real FactGrid edit or document creation was performed.

Independent review found and corrected refresh races, false freshness, malformed
checkpoint publication, missing inventory/title/alias search terms, optional JSON
failures, duplicate document revisions and malformed attribution. Final integrated
review found no significant security regression. See
[security/QA review](security-qa-review.md),
[catalogue review](catalogue-independent-review.md),
[frontend review](frontend-independent-review.md), and
[scholarly review](frontend-scholarly-review.md).

## H. Verification

| Command / check | Result |
|---|---|
| Baseline `npm.cmd test` | 290 tests, 34 files passed |
| Final `npm.cmd run lint` | Passed |
| Final `npm.cmd run typecheck` | Passed |
| Final `npm.cmd test` | 353 tests, 42 files passed |
| Final `npm.cmd run build` | Passed, no tracing warnings |
| `npm.cmd run test:e2e -- --workers=2` | 81 passed, 1 intentional desktop skip of a mobile-only assertion |
| `npm.cmd run test:e2e:live` | 4 passed; read-only, seven representative records |
| `npm.cmd run test:docker` | OAuth 1.0a production build/runtime/browser/persistence/security checks passed; task resource cleanup verified |
| Production-build real-index HTTP smoke | 8 requests passed, deep pages disjoint, HS 751/combined filters/facets verified |
| Plain native Windows `npm.cmd ci` | Blocked by missing Visual Studio C++ toolset |
| `npm.cmd ci --ignore-scripts` | Passed; bundled native binary and full unit suite work |
| Plain `npm ci` in local Linux Docker build | Passed |

PowerShell requires `npm.cmd` because its `npm.ps1` wrapper is blocked. The default
Playwright binary was absent; installed Chrome was used through the existing
override. Two stale ignored fixture-cache entries initially caused false failures;
their contents were verified and only those entries removed before the full pass.
New return-navigation assertions were updated to verify the preserved browse URL.
No CI settings or existing checks were removed or weakened.

The shared Docker daemon had exhausted default pools; the successful isolated run
used verified unused `10.250.251.0/24`, without pruning existing resources or
changing global settings. OAuth 2 retains unit/integration coverage; this pass did
not rerun the separate OAuth 2 Docker variant. No live OAuth write acceptance is
claimed.

## I. Delivery and release artifact

The final commit containing this report is prepared after verification and sent
in one coordinator push to `main`, subject to branch controls. The exact SHA and
push result belong in the delivery response; this report does not claim a push
or external deployment before they occur. No PR or intermediate worker push is
part of delivery. The repository CI is validation only, not the university's
deployment mechanism.

The completed artifact is intentionally ignored by Git:

- `.data/catalogue-index.json`: 57,301,503 bytes;
  SHA-256 `dc998bdd8d9d1a4b9dafe00a67e6901fc06022c50ae6e4fe555a78c4d39766fe`.
- `.data/catalogue-index.json.gz`: 5,504,908 bytes;
  SHA-256 `99852cd7dd0e0f4c284010278f33a3c6f43cb26806b7ef80fcf837b7fe7f19b1`.

Transfer the validated artifact through the operator's normal release channel,
decompress if needed, mount it at `FACTGRID_CATALOGUE_INDEX`, and build the release
with `FACTGRID_BUILD_REVISION=<full Git SHA>`. `/api/version` exposes the embedded
revision, policy and discovery freshness without secrets. The local build used
an unspecified revision and correctly returned null; it is not a release-SHA
claim. [Operations](../operations.md#release-provenance-and-university-deployment)
contains exact build/mount/verification steps.

## J. Remaining external requirements and limits

1. The university operator must release the commit and discovery artifact, then
   verify `/cuneiform/api/version`, HS 751, filters and existing records. No
   external restart, deployment or infrastructure change was attempted.
2. Historical 404 attribution needs deployment logs; current production baseline
   did not reproduce it and exposed no exact revision identifier.
3. Differently modelled/unclassified tablets are not proven covered. RDF/search
   lag and balanced scan-time changes remain possible; direct eligible URLs work
   independently and refresh freshness is visible.
4. Source metadata can be absent, editions can be missing, and unrecognized ATF
   layouts remain read-only/source-linked. The app does not invent missing data.
5. A handled unsupported/upstream page message currently returns HTTP 200;
   genuinely missing records use not-found. A whole optional document-batch
   failure affects that batch. Existing bounded edition limits remain visible.
6. Native Windows clean install needs the C++ toolset; local Linux Docker clean
   install passed. The current artifact is below the explicit 64 MB bound;
   operators must monitor growth and review resource bounds if refresh rejects it.
