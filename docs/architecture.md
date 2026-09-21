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
  └─ private routes ─> OAuth/session layer ─> FactGrid OAuth 2
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

FactGrid OAuth 2 authorization code flow is implemented with `oauth4webapi`, an
exact callback, exact state validation, and S256 PKCE. OAuth endpoints are explicit;
FactGrid is not treated as an OpenID Connect discovery provider.

The browser receives only opaque HttpOnly cookies and an application CSRF value.
Provider access and refresh tokens are encrypted at rest in a minimal SQLite
session table; opaque session identifiers are stored only as hashes. Cookies are
SameSite=Lax, scoped to `/`, and Secure in production. Sessions expire and are
deleted on logout. A new login revokes the prior session for the same FactGrid
identity, active rows are capped, and on POSIX the database file is forced to
owner-only permissions. The SQLite file is operational session state, not a
catalogue or account database.

This design expects one application instance with a persistent writable volume.
Multiple replicas require a shared session-store implementation, which is outside
this MVP.

## Write trust boundary

Every edit is reconstructed and authorized on the server. A browser submits only
the tablet QID, P251 statement GUID in the route, base revision, replacement text,
and edit summary. It cannot choose a URL, wiki title, property, or operation.

Before one non-retried `action=edit` request, the service verifies:

- complete auth configuration, feature switch, approved editor, and approved target;
- exact request origin and application CSRF token;
- a live, refreshed provider session and fresh FactGrid identity, block, and edit-right state;
- current P251 membership and its exact fixed-host document title;
- existing wikitext page, page protection/action eligibility, expected base revision,
  and one supported plain `D-Q…` transcript region, identified either by the
  exact transliteration RDFa property or by a unique poem in an exact Transcript
  or Transliteration section;
- bounded UTF-8 input with no structural wiki markup or forged poem boundary.

The adapter splices only the transcript byte range and preserves every byte outside
it. FactGrid receives `nocreate`, revision conflict parameters, and an edit summary.
The service then reads the saved revision back and confirms the revision and
complete source text. For a changed save it also confirms the FactGrid username,
user ID attribution, and effective edit summary.
Network failures after submission are reported as an ambiguous outcome and are not
blindly retried.

## Rendering boundary

React escapes record strings and editor previews. Wikitext display is reduced to
sanitized plain text; raw MediaWiki HTML is never injected. External URLs are
scheme-validated and rendered as outbound links. Record images remain links unless
item-specific reuse rights are known.
