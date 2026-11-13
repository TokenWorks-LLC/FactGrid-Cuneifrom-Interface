# Architecture

## Shape

The application is one Next.js service. Server components render public pages;
route handlers own OAuth, session state, and writes. A compact, read-only discovery
artifact holds identifiers, search terms, and facet values. There is no local
scholarly text store, editable entity replica, or user account database.

```text
Browser
  ├─ public pages ──> server-only FactGrid read adapter
  │                    ├─ MediaWiki Action API (entities, search, revisions)
  │                    └─ FactGrid SPARQL (contract discovery; never request-critical)
  └─ private routes ─> OAuth/session layer ─> FactGrid OAuth 1.0a / OAuth 2
                     └─ write service ──────> MediaWiki Action API
```

Public and private data paths stay separate. Core public entity reads use a
short Next.js revalidation window; optional document/label and arbitrary search
requests bypass the persistent Next cache. `/api/session`, OAuth responses, and writes are always private and
`no-store`. A successful write invalidates the affected tablet route.

## Public reads

`src/lib/factgrid` centralizes fixed endpoints, property mappings, validation,
adapters, and source-format rules. It:

1. applies text and six facet filters to a validated, policy-versioned discovery
   index before pagination, using strict QID ordering; without an index it uses
   explicitly incomplete CirrusSearch and its 10,000-result window;
2. batch-loads authoritative entities and rechecks active tablet membership and
   current filters; stale entries leave page holes without repeating later items;
3. resolves optional related labels independently, retaining linked QIDs and a
   warning if label requests fail;
4. resolves only bounded, linked P251 documents with exact same-record titles;
   missing, unsupported, malformed, and unavailable editions keep their positions
   and source links without hiding metadata or other editions;
5. searches catalogue-wide facet values with readable labels and bounded option
   pages; contextual/general-name fallback is explicitly marked incomplete;
6. keeps P69 external transcripts as outbound links and loads external images only
   when a visitor selects them in the viewer.

Requests use fixed FactGrid hosts and paths, blocked redirects, timeouts, response
size limits, bounded result counts, and an identifying user agent. Search snippets
and rendered MediaWiki HTML are not trusted or displayed.

`eligibility.ts` separates readable-tablet eligibility from editable-entity
eligibility. The verified P3 subclass closure currently contains only Q512006,
**Clay tablet**. It is not an Old Assyrian class. No alternative classification
was admitted without live evidence. Direct tablet URLs use API entities
independently of discovery-index presence.

The operator runs `scripts/refresh-catalogue-index.mjs` outside visitor requests.
It discovers bounded, strictly ordered QID batches, projects discovery metadata,
resolves facet labels, checkpoints progress, and publishes after exhaustion and
count validation. Invalid refreshes retain the published artifact; the runtime
retains its last successfully validated in-memory index. Operations documents
the refresh procedure and limits of a nontransactional RDF scan.

Optional document and related-label reads use `no-store` so manual source retries
can recover immediately. Core metadata retains its short revalidation window.
There are no timer retries or per-edition request fan-outs. A batch transport
failure is shown on each affected edition.

## Authentication and sessions

New deployments select OAuth 1.0a using `FACTGRID_OAUTH_VERSION=1.0a`. Request and
access-token exchanges use signed MediaWiki requests; authenticated API requests
sign the complete query or form body. The signed `Special:OAuth/identify` JWT is
verified with `jose`, including its algorithm, issuer, audience, age, expiry, and
request nonce. Temporary request-token credentials are encrypted in SQLite and
bound to a short-lived browser transaction; callbacks consume them once.

Existing OAuth 2 authorization code flow remains implemented with `oauth4webapi`, an
exact callback, exact state validation, and S256 PKCE. OAuth endpoints are explicit;
FactGrid is not treated as an OpenID Connect discovery provider.

The browser receives only opaque HttpOnly cookies and an application CSRF value.
Provider access tokens, OAuth 1.0a token secrets, and OAuth 2 refresh tokens are encrypted at rest in a minimal SQLite
session table; opaque session identifiers are stored only as hashes. Cookies are
SameSite=Lax, scoped to `/`, and Secure in production. Sessions expire and are
deleted on logout. OAuth 1.0a sessions use the local expiry and never attempt an
OAuth 2 refresh-token exchange. A new login revokes the prior session for the same FactGrid
identity, active rows are capped, and on POSIX the database file is forced to
owner-only permissions. The SQLite file is operational session state, not a
catalogue or account database.

Every session is bound to the configured OAuth protocol, fixed issuer, and exact
consumer/client registration. A configuration change, or a legacy row without
those bindings, requires a fresh login. OAuth identity timestamps use one explicit
30-second tolerance while preserving signature, issuer, audience, nonce, age, and
expiry checks. Provider token/profile responses are streamed through a 64 KiB byte
limit and individual token fields are capped before storage.

This design expects one application instance with a persistent writable volume.
Multiple replicas require a shared session-store implementation, which is outside
this MVP.

## Write trust boundary

Every edit is reconstructed and authorized on the server. All write routes require
the feature switch, exact origin, application CSRF token, a usable provider session,
a fresh FactGrid identity, no current block, effective API rights, an applicable
OAuth grant when the provider reports grants, and per-identity rate limits. The
optional `restricted` contributor policy additionally requires an exact username
allowlist for all writes and an exact document-target allowlist for transcription
updates and creation. Metadata writes by approved editors may affect any current
catalogue tablet; they do not consult the document-target allowlist. The default
`authenticated` policy removes those deployment allowlists, not the live FactGrid
or current-record checks.

Editing defaults to enabled when the switch is omitted; an explicit `false` or
invalid switch value disables writes. Authentication and every other write check
remain mandatory. Existing deployment settings override the new defaults.

Unauthenticated OAuth starts and callbacks are bounded before provider or
session-store work. A checked-in nginx boundary rate-limits by source address and
overwrites the application client-identity and forwarding headers; the bounded
in-process limiter is defense in depth for the documented single instance.

Three bounded mutation paths exist:

1. Existing transcript update: the browser identifies the selected P251 statement
   and supplies a base revision, replacement text, and summary. The server resolves
   the current fixed-host page, verifies one supported plain transcript region and
   page action eligibility, splices only that byte range, and sends `action=edit`
   with `nocreate` and conflict parameters.
2. Metadata update: the browser submits capped, typed operations against a base
   entity revision. The server reloads the full item and property definitions,
   validates statement GUIDs, qualifier/reference hashes and datatype values, then
   sends one partial `wbeditentity` patch with `baserevid`. P2 removal/replacement
   requires explicit catalogue-membership confirmation. P251 is read-only in the
   general metadata editor and belongs to the dedicated transcript workflows.
   Exact duplicate new statements (including duplicates of current claims) are
   rejected without rewriting historical duplicates. Hashes are checked in their
   actual statement/property/reference scope rather than globally.
3. Missing transcript creation: the server derives `D-Q{qid}` and all wikitext,
   verifies current membership and transcript state, creates with `createonly`,
   confirms the page, and links it through a revision-guarded P251 metadata patch.
   It never imports P69 or browser-supplied wiki structure.

The editor offers creation when no document is linked or the linked canonical
`D-Q{qid}` page is missing. It checks the canonical page's existence without loading
document revisions. Existing canonical pages, including unsupported formats, are
not offered for creation. The save handler rechecks authoritative state and uses
`createonly`; this display check never authorizes a write or permits overwriting.

Every successful path reads authoritative state back and checks the intended change,
untouched data, revision, username/user ID attribution, and effective summary before
reporting success. A post-submit network failure becomes an explicit unknown,
accepted-unconfirmed, or partial outcome as appropriate; it is not blindly retried.
Wikibase attribution accepts the generated `wbeditentity-update` operation marker
instead of claiming the appended custom summary can be recovered exactly. Creation
recovery inspects deterministic upstream page and P251 state so a retry can finish
an already-created-but-unlinked page without duplicating either resource. There is
deliberately no local scholarly write journal.

## Rendering boundary

Exact `CDLI-ATF-L-Q{qid}` editions with a recognized single ATF poem use escaped,
verbatim text instead of the wikitext simplifier. Line breaks, directives,
brackets, and notation are preserved. ATF remains read-only and cannot enter the
D-page splice contract. Edition anchors preserve linked-statement order,
including failed editions, and open the requested disclosure after loading.

`/api/version` exposes only an explicitly supplied build revision, eligibility
policy, and discovery freshness/count. It performs no FactGrid requests and does
not infer deployment success from a Git push.

`/tablets/[qid]/edit` renders a public record header and an access message. It
loads the uncached full entity DTO and mounts editing controls only after
`/api/session` confirms an authenticated, eligible contributor. There is no second
preview editor or fallback draft mode. Signed-out visitors receive a login link;
unavailable, disabled, denied, and failed-load states display an explanation only.
Eligible contributors can review and save metadata or create a missing local
transcription. Existing supported transcript regions remain editable in edition
context on the tablet page. Every write route independently verifies authorization;
the client gate is presentation, not the security boundary.

All three editors register with one account-scoped draft-protection layer. It
guards application links and logout before navigation, retains the native unload
warning, and restores scoped session drafts after reload or browser history
traversal. Confirmed saves and deliberate discards clear only the relevant draft;
unknown and accepted-unconfirmed outcomes retain it.

React escapes record strings and transcript previews. Wikitext display is reduced to
sanitized plain text; raw MediaWiki HTML is never injected. External URLs are
scheme-validated. Record images are loaded from external hosts only after a visitor
selects one in the zoom viewer; the original source link and rights notice remain
visible. IIIF manifests are read in the browser when their hosts permit CORS.
P1034 model URLs are validated as outbound links. Confirmed Heidelberg PLY files
are fetched directly by the browser only after the reader activates the viewer;
unsupported models remain source links.

## Simplicity review — 29 September 2026

This is a historical review. The November 2026 expansion adds a compact discovery
artifact; it does not add a scholarly text replica or change the single-instance
session-store requirement.

The application remains one Next.js service with direct FactGrid API calls and a
SQLite session store. There is no separate backend service, queue, local catalogue,
scholarly write journal, or replica coordination. The temporary public draft editor
has been removed, including its separate metadata form, per-edition practice
drafts, hydration check, and preview-only branches in the transcription editor.
The remaining paths correspond to the three actual operations: update a document,
update an item, and create then link a document.

The metadata and creation services are large (roughly 1,100–1,200 lines each).
Datatype conversion, partial-entity updates, revision checks, and recovery between
document creation and linking account for much of that size. They also duplicate
some bounded-response parsing and provider-error handling. These are maintenance
hotspots, not a reason to add a generic workflow framework or remove validation.
Consolidate small helpers when those paths next change and retain their existing
contract tests. OAuth 2 remains for documented compatibility; new deployments use
OAuth 1.0a. No dependency or additional service was needed for this cleanup.
