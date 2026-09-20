# Verified FactGrid contract

The contract below was checked read-only against FactGrid on 20 September 2026.
It intentionally records uncertainty and avoids turning observed conventions into
universal guarantees.

## Endpoints

| Purpose | Endpoint |
|---|---|
| MediaWiki/Wikibase API | `https://database.factgrid.de/w/api.php` |
| SPARQL | `https://database.factgrid.de/sparql` |
| OAuth authorization | `https://database.factgrid.de/w/rest.php/oauth2/authorize` |
| OAuth token | `https://database.factgrid.de/w/rest.php/oauth2/access_token` |
| OAuth profile | `https://database.factgrid.de/w/rest.php/oauth2/resource/profile` |

The `/query/` path is the human query UI, not the machine SPARQL endpoint. No
working OpenID discovery endpoint was found, so OAuth configuration is explicit.

## Catalogue and properties

The project query and live records establish clay-tablet membership as `P2=Q512006`.
Interactive search uses CirrusSearch with that clause before pagination, then
revalidates membership through current entity claims.

| Property | Verified use in this interface |
|---|---|
| P2 | Instance of; `Q512006` defines catalogue membership |
| P11 | Optional title; entity label remains the normal display name |
| P692 | CDLI ID |
| P329 | Present holding / collection |
| P10 | Inventory number qualifier on P329; displayed as an identifier |
| P695 | Finding spot |
| P853 | Period / style |
| P18 | Language |
| P121 | Work type |
| P401 | Material |
| P59, P60, P61 | Dimensions |
| P188 | Online image URL |
| P189 | Wikimedia Commons image |
| P69 | Online transcript; kept as an external link |
| P251 | FactGrid document page; resolved as a separate edition |

Global grouped and `SELECT DISTINCT` facet scans proved too expensive for an
interactive request—even a result limit did not bound scan work. The runtime
therefore forms contextual choices from P329/P695/P853 values on the current
result page. A selected QID is still applied in CirrusSearch together with
`P2=Q512006` before pagination; it is never a local post-filter.

## Representative records

These are test cases for behavior, not hard-coded product content:

- `Q892185`: sparse metadata and no transcript;
- `Q893955`: multiple image links and no transcript;
- `Q1089841`: one simple `D-Q…` document-page candidate;
- `Q499899`: multiple distinct D/CDLI/ORACC/Unicode editions;
- `Q1361363`: structured CoNLL-U document, read-only;
- `Q471142`: external P69 transcript only;
- `Q499894` and `Q1371532`: examples of missing P251 targets.

The API and SPARQL services were reachable during investigation. CirrusSearch was
also observed timing out later; the application preserves that as an upstream
error rather than reporting a false empty result.

## Transcript rules

P251 values are not one universal plain-text property. Current titles include
mixed scholarly D pages, token-level CDLI/ORACC material, Unicode glyph pages,
CoNLL-U corpora, and missing pages.

The MVP reads a bounded set of linked pages and identifies editions separately.
Reading also recognizes one unambiguous plain `<poem>` inside a Transcript or
Transliteration section. Without the exact `hasTransliteration` RDFa property it
remains read-only. Editing is restricted to an exact FactGrid-hosted `D-Q{qid}`
page whose current wikitext contains exactly one property-marked poem region with
neither structural wikitext nor structured token rows. Every other format is
read-only. The content outside the recognized region is preserved byte-for-byte.
Document preamble and other headed sections are exposed as source notes where
they reduce to safe readable text.

P69 links are never scraped or imported. Sampled OARE P69 links returned 404 at
investigation time, so the UI labels them neutrally and does not promise availability.

## Images and rights

P188 does not reliably encode item-specific reuse rights. Those images are linked,
not proxied or embedded. The few P189 Commons values can provide stronger provenance,
but each file still requires its own license check. The homepage uses one separately
verified Commons photograph with visible attribution.

## Identity and editing policy

FactGrid runs an independent account system. OAuth 2 supports confidential clients,
authorization code, refresh tokens, bearer-authenticated API calls, PKCE, profile
fields, and edit grants. The minimum requested project grant is `editpage`; identity-
only access cannot write through the Action API.

Only a FactGrid administrator can register/approve this consumer on the current
instance. No published cuneiform-specific editor policy was found. Consequently,
the application additionally requires a deployment-maintained exact username
allowlist and exact target allowlist, and editing defaults to disabled.

## Primary references

- [FactGrid: Before 500](https://database.factgrid.de/wiki/FactGrid:Before_500)
- [FactGrid Cuneiform Project](https://database.factgrid.de/wiki/FactGrid:Cuneiform_Project)
- [Wikibase API](https://www.mediawiki.org/wiki/Wikibase/API)
- [MediaWiki revisions API](https://www.mediawiki.org/wiki/API:Revisions)
- [MediaWiki edit API](https://www.mediawiki.org/wiki/API:Edit)
- [OAuth for MediaWiki developers](https://www.mediawiki.org/wiki/OAuth/For_Developers)
