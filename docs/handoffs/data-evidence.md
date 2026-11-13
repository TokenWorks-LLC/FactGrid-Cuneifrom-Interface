# Read-only FactGrid corpus evidence

Observed 13 November 2026 against the public MediaWiki API and SPARQL service.
No FactGrid mutations were performed. Reproduction uses fixed public endpoints
and GET requests. PowerShell `Invoke-WebRequest -UseBasicParsing` worked after
the sandbox's initial network restriction; the web browsing tool encountered a
`mod_repudiator` challenge on wiki pages. This is a transport distinction, not
evidence that items are absent.

## Authoritative entities

One `wbgetentities` request with `props=labels|claims|info` returned HTTP 200 in
289 ms, 77,168 bytes, for the following eight entities. These are single local
measurements, not latency guarantees.

| Item | English label | Revision | Active P2 | P251 |
| --- | --- | --- | --- | --- |
| Q894483 | Cuneiform Tablet HS 751 | 20736312 | Q512006 | CDLI-ATF-L-Q894483 |
| Q499899 | Cuneiform Tablet Prag I 437 | 21762183 | Q512006 | D/CDLI-W/ORACC-W/UNICODE-W |
| Q1089841 | Cuneiform Tablet KHT 100 | 20086625 | Q512006 | D-Q1089841 |
| Q894307 | Cuneiform Tablet HS 1004 | 20735097 | Q512006 | none |
| Q892185 | Cuneiform Tablet TMr 16 | 8207606 | Q512006 | none |
| Q1361363 | Cuneiform Tablet Kt 92/k 203 (AKT 5 2) | 19258599 | Q512006 | CoNLL-U-Q1361363 |
| Q471142 | Cuneiform Tablet ArOr 47 42-43 | 21765775 | Q512006 | none |
| Q512006 | Clay tablet | 21367899 | Q11208, Q251694 | none |

The hypothesis that Q512006 means Old Assyrian, or that HS 751 lacks this
classification, is disproven. Existing membership accepts HS 751. A reported
historical 404 cannot be attributed to classification from this evidence.

HS 751 has collection P329 Q21880 (Friedrich-Schiller-University Jena), finding
spot P695 Q390017 (Nippur (mod. Nuffar)), period P853 Q512142 (Early Dynastic
IIIb Period), language P18 Q471149 (Sumerian). The collection claim is an
institution; the app must not replace it with an inferred collection entity.

## Class closure and broader discovery

P3 was verified as `Subclass of`. This bounded SPARQL query returned exactly
Q512006, one row, HTTP 200, 216 ms:

```sparql
PREFIX wd: <https://database.factgrid.de/entity/>
PREFIX wdt: <https://database.factgrid.de/prop/direct/>
SELECT ?class WHERE { ?class wdt:P3* wd:Q512006 } LIMIT 1000
```

No alternative subclass was observed. A P251 query for `CDLI-ATF-L-` documents
whose item lacks `wdt:P2 wd:Q512006` returned zero rows (447 ms, limit 20).
This rules out that particular alternative pattern in the RDF view, not every
possible differently modelled tablet in FactGrid. There is no evidence here to
admit arbitrary items through a CDLI identifier, title, material, or guessed
document name. Future alternative classes require explicit source evidence.

The read policy exports a versioned verified P2 class closure; mutation eligibility
retains the original exact P2 class separately. They currently return identical
decisions, deliberately. Authorizing a contributor remains a separate concern.

## Corpus and facet measurements

A one-off aggregate over the RDF direct class returned 152,633 distinct items,
99 holdings, 171 finding spots and 32 periods in 10,254 ms. The query used
`COUNT(DISTINCT ...)` with optional P329/P695/P853 joins. It must not run on
interactive requests. A separate UNION aggregate for counts of *items having*
each metadata property timed out after 15,025 ms; those completeness counts
remain unknown. Distinct value counts do not imply complete item metadata.

Agent C independently observed CirrusSearch totalhits 152,640. The seven-item
difference between RDF and search demonstrates separate index freshness; do
not combine those counts into a claim of synchronized authoritative coverage.

## ATF edition provenance

HS 751 explicitly links the exact trusted URL
`https://database.factgrid.de/wiki/CDLI-ATF-L-Q894483` in normal-rank P251
statement `Q894483$0ACD95A8-BDFF-4584-BE3C-7104AB8745D0`.
The page exists (pageid 1994314), revision 20109826, parent 0, timestamp
2026-06-15T16:48:55Z, wikitext/text-x-wiki. Its source contains CuneiformInfoBox,
the FactGrid item link, one poem block, and CuneiformImageFC. The poem begins
`&P020415 = TMH 5, 001`, then ATF version/language directives and tablet,
obverse, reverse and column markers plus numbered transliteration lines.
The source must remain unchanged and read-only. It is the sole active P251
edition, so its source order corresponds to `#edition-1`.

Actual bounded API responses are stored in
`tests/fixtures/factgrid/live-q894483-entity.json` and
`tests/fixtures/factgrid/live-q894483-document.json`, for regression tests and
source attribution. They are observations, not a replacement scholarly archive.

## Completed discovery scan

The coordinator exhausted the reviewed non-deprecated-statement discovery policy
from 2026-11-13T07:49:15.905Z through 2026-11-13T08:21:05.072Z. The 152,633
enumerated IDs agree with start/end counts. This is an interval scan of the RDF
view, not a transactionally frozen API corpus. It contains 100 holding QIDs,
171 finding spots and 32 periods. The earlier direct/truthy aggregate's 99
holdings differs for a verified reason: Q1350401 has normal-rank P329 Q1350403
alongside preferred-rank Q2230311. The API confirmed both statements. The
application and discovery policy retain both non-deprecated values; the RDF
`wdt:P329` view omits the normal-rank value when a preferred statement exists.
The extra value is not an inferred or invented holding.
