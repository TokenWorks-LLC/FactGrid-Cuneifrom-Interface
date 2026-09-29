# Architecture

## Shape

The application is one Next.js service. Server components render public pages;
route handlers own OAuth, session state, and writes. There is no local copy of
the catalogue, search index, user database, or scholarly revision store.

```text
Browser
  ├─ public pages ──> server-only FactGrid read adapter
  │                    ├─ MediaWiki Action API (entities, search, revisions)
  │                    └─ FactGrid SPARQL (contract discovery; never request-critical)
  └─ private routes ─> OAuth/session layer ─> FactGrid OAuth 1.0a / OAuth 2
                     └─ write service ──────> MediaWiki Action API
```

Public and private data paths stay separate. Public entity/document reads use a
short Next.js revalidation window; arbitrary search requests bypass the persistent
Next cache. `/api/session`, OAuth responses, and writes are always private and
`no-store`. A successful write invalidates the affected tablet route.

## Public reads

`src/lib/factgrid` centralizes fixed endpoints, property mappings, validation,
adapters, and source-format rules. It:

1. asks CirrusSearch for Item-namespace results with `P2=Q512006` and selected
   facet clauses already applied;
2. batch-loads authoritative entities and rechecks current, non-deprecated
   catalogue membership;
3. batch-loads labels for referenced entities;
4. resolves bounded P251 document links to exact FactGrid titles and reads their
   current revisions;
5. derives contextual collection, findspot, and period choices from structured
   values on the current result page, then pushes a selected QID back into the
   Cirrus membership query before pagination;
6. keeps P69 external transcripts and unlicensed image URLs as outbound links.

Requests use fixed FactGrid hosts and paths, blocked redirects, timeouts, response
size limits, bounded result counts, and an identifying user agent. Search snippets
and rendered MediaWiki HTML are not trusted or displayed.

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

This design expects one application instance with a persistent writable volume.
Multiple replicas require a shared session-store implementation, which is outside
this MVP.

## Write trust boundary

Every edit is reconstructed and authorized on the server. All write routes require
the feature switch, exact origin, application CSRF token, a usable provider session,
a fresh FactGrid identity, no current block, effective API rights, an applicable
OAuth grant when the provider reports grants, and per-identity rate limits. The
default `restricted` contributor policy additionally requires exact username and
target allowlists. The explicit `authenticated` policy removes those deployment
allowlists, not the live FactGrid or current-record checks.

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
3. Missing transcript creation: the server derives `D-Q{qid}` and all wikitext,
   verifies current membership and transcript state, creates with `createonly`,
   confirms the page, and links it through a revision-guarded P251 metadata patch.
   It never imports P69 or browser-supplied wiki structure.

Every successful path reads authoritative state back and checks the intended change,
untouched data, revision, username/user ID attribution, and effective summary before
reporting success. A post-submit network failure becomes an explicit unknown or
partial outcome; it is not blindly retried. Creation recovery inspects deterministic
upstream page and P251 state so a retry can finish an already-created-but-unlinked
page without duplicating either resource. There is deliberately no local scholarly
write journal.

## Rendering boundary

`/tablets/[qid]/edit` renders a public record header and an access message. It
loads the uncached full entity DTO and mounts editing controls only after
`/api/session` confirms an authenticated, eligible contributor. There is no second
preview editor or fallback draft mode. Signed-out visitors receive a login link;
unavailable, disabled, denied, and failed-load states display an explanation only.
Eligible contributors can review and save metadata or create a missing local
transcription. Existing supported transcript regions remain editable in edition
context on the tablet page. Every write route independently verifies authorization;
the client gate is presentation, not the security boundary.

React escapes record strings and transcript previews. Wikitext display is reduced to
sanitized plain text; raw MediaWiki HTML is never injected. External URLs are
scheme-validated and rendered as outbound links. Record images remain links unless
item-specific reuse rights are known.

## Simplicity review — 29 September 2026

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
