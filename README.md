# FactGrid Cuneiform Interface

A focused interface for discovering and reading cuneiform tablet records from
[FactGrid](https://database.factgrid.de/). FactGrid remains authoritative for
catalogue data, document pages, accounts, permissions, and revision history.

The MVP provides:

- membership-restricted tablet search with collection, findspot, and period filters;
- stable QID-based record pages with metadata, source-separated editions, image links, and external transcript links;
- safe plain-text display of supported FactGrid document pages;
- FactGrid OAuth 2 authorization-code sign-in with PKCE and server-side sessions;
- a deliberately narrow editor for one verified plain `D-Q…` transcript region;
- fail-closed editing when OAuth, editor policy, or target allowlists are absent.

OAuth and live writes are implemented and contract-tested, but are not configured
or claimed as live-verified. They require a FactGrid-approved OAuth consumer, an
approved editor policy, and a designated write-test record. Public reading works
without authentication.

## Quick start

Requirements: Node.js 22 or newer and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open <http://127.0.0.1:3000>. The default empty OAuth settings intentionally put
the site in reading mode. The shared desktop/mobile header still shows
`Log in with FactGrid`, marked `Unavailable`; it links to an explanation instead
of a failing API response. With complete OAuth configuration the same entry starts
the real provider flow and returns to the validated internal page. A signed-in
account name and logout replace it. Sign-in availability does not imply edit
permission: editing remains separately switch- and allowlist-gated.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run test:docker
npm run test:e2e
npm run test:e2e:live
npm run build
npm run check
```

`test:e2e` is the required deterministic desktop/mobile acceptance suite. It
replays the checked-in, explicitly labelled FactGrid adapter fixtures at the
network boundary while exercising the real Next.js server and browser UI.
`test:e2e:live` is a separate bounded desktop smoke check against current public
FactGrid records; upstream availability is reported in CI but does not replace
or gate the deterministic acceptance suite.

`test:docker` builds and runs the production image, exercises the reading-only
desktop/mobile interface, and completes an isolated synthetic OAuth session
through a local TLS reverse proxy. It verifies non-root execution, private
SQLite/WAL permissions, session survival across container replacement, logout
survival across a second replacement, and required response headers. It requires
a running Docker daemon plus the locally installed Playwright Chromium binary;
it never contacts a live OAuth provider or performs a scholarly write.

Playwright needs Chromium once on a new machine:

```bash
npx playwright install --with-deps chromium # clean Linux host/CI
npx playwright install chromium             # macOS/Windows
```

## Documentation

- [Architecture](docs/architecture.md)
- [Verified FactGrid contract](docs/factgrid-contract.md)
- [Deployment and operations](docs/operations.md)
- [Product direction](PRODUCT.md)
- [Design system](DESIGN.md)

## Scope

This release does not provide maps, 3D viewing, tablet creation, metadata edits,
uploads, annotation workflows, advanced linguistic search, a local scholarly
database, or local revision history. Unsupported document formats remain readable
where possible and link back to their source; they are never flattened into a
single editable transcript.

## Data and attribution

FactGrid structured data is CC0. Linked publications and images retain their own
terms. The homepage photograph is “Cuneiform tablet and envelope, MAHG 16161” by
Rama, offered under CC BY-SA 3.0 France; its Commons file page is linked beside
the image.

## Current verification boundary

A read-only coverage check on 21 September 2026 found two format-compatible plain
D transcripts among all five current exact D-Q candidates. Both remain ineligible
for writes in the default configuration because editing and the exact editor/target
allowlists are closed. See the contract document for complete structured-property
counts, bounded content samples, and the remaining read-only source families.
