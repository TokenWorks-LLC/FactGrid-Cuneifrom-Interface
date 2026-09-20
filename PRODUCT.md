# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated by the implementation brief: one Next.js application with TypeScript, Tailwind CSS, and shadcn/ui; FactGrid remains the authoritative data and identity service.

## Users

Researchers, students, and other readers browsing cuneiform tablets need to find records, compare available editions, read scholarly text, and follow sources without learning FactGrid's internal data model. Authorized FactGrid contributors also need a careful path to update supported FactGrid-hosted transliterations under their own identity.

## Product Purpose

FactGrid Cuneiform Interface is a focused reading and discovery layer over FactGrid's cuneiform catalogue. Success means that a reader can search or browse to a stable QID-based tablet page, understand which metadata and textual witnesses actually exist, and reach the authoritative source; an authorized contributor can edit only a verified supported transcript without losing scholarly notation or overwriting a newer revision.

## Positioning

The interface translates verified FactGrid records, linked document pages, and edition provenance into a restrained tablet-reading experience while leaving records, identity, permissions, and revision history in FactGrid.

## Operating Context

Readers arrive with tablet names, collection numbers, identifiers, periods, collections, or findspots. Records can be sparse, link to several editions, store transcripts in different formats, or point to external sources. Public reading should remain useful when sign-in or editing is unavailable. Editing is high-stakes scholarly work and must preserve source structure, show conflicts, and return users to FactGrid's history.

## Capabilities and Constraints

- Homepage, URL-driven catalogue search, QID-based tablet pages, and an about/source page are in scope.
- Search must restrict catalogue membership before pagination and expose only filters supported by verified FactGrid predicates.
- FactGrid is the only scholarly record store; no local catalogue, search index, CMS, or password system is permitted.
- Authentication must use FactGrid's supported OAuth flow and remain disabled until client credentials, callback configuration, session security, and an approved editor policy are present.
- Writes are limited to a server-resolved, supported FactGrid-hosted transcript target associated with the selected tablet edition. Unsupported or external formats stay read-only.
- Maps, 3D, annotations, metadata editing, uploads, record creation, advanced linguistic search, dashboards, and local revision storage are outside the MVP.
- Live scholarly writes require a designated authorized test record. Fixtures may test behavior but must never be presented as live FactGrid data.

## Brand Commitments

- Product name: “FactGrid Cuneiform Interface”.
- The experience should be simple, polished, scholarly, and inspired by the clarity of CDLI browsing without implying a CDLI affiliation.
- Voice is concise and source-conscious. It states missing or unavailable information plainly and never invents statistics, affiliations, endorsements, or record content.
- FactGrid and source providers receive clear attribution.

## Evidence on Hand

- FactGrid's live Wikibase, MediaWiki API, SPARQL endpoint, record pages, and revision history are the primary evidence.
- The supplied starting record is FactGrid item Q499899 (Prag I 437) with its linked document page D-Q499899.
- The repository began empty; there are no inherited product assets, testimonials, institutional marks, or usage claims.

## Product Principles

- Provenance before polish: label editions and link back to the authoritative source.
- Honest absence: distinguish missing data, unsupported formats, upstream errors, and empty results.
- Reading first: keep public discovery complete without requiring an account.
- Fail closed on scholarly writes: authentication never implies edit authorization.
- Preserve the source: never flatten mixed wiki content or silently overwrite revisions.

## Accessibility & Inclusion

The public reading and editing journeys must work with keyboard navigation, visible focus, readable contrast, responsive layouts, long identifiers, Unicode and diacritic text, reduced motion, and clear status/error language.
