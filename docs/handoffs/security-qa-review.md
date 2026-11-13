# Independent security and acceptance review

Reviewed 13 November 2026 by Agent F, independently of the eligibility, loading,
catalogue, ATF, and frontend implementations. This review used source inspection,
deterministic fixtures, and local tests. It performed no live FactGrid mutations.

## Boundaries reviewed

- Read eligibility is independent of discovery-index inclusion. An unrelated
  entity placed in an otherwise valid index is excluded from search results,
  direct loading, editable metadata loading, and current-edition resolution.
- `getEditableTabletEntity()` and `resolveCurrentEdition()` retain the legacy
  editable class; neither trusts partial read success or index membership.
  Metadata saves obtain a fresh full entity; the membership bypass used for
  post-write readback follows an already authorized revision-guarded mutation.
- Transcription creation still derives `D-Q{qid}` on the server, checks the legacy
  class, provider rights, page/entity actions, current P251 state, `createonly`,
  conflict protection, and authoritative attribution/readback.
- Metadata, transcript-update, and creation routes retain same-origin checks,
  CSRF verification, usable sessions, contributor policy, fresh provider
  identity, grants, rights, blocks, and rate limiting. OAuth/session code was
  not widened by the corpus changes.
- ATF remains read-only even for an authorized account with an authenticated
  target policy and provider permission to edit the page. The real edit-client
  inspection rejects it before any edit submission.
- Fixed FactGrid origins, blocked redirects, exact QID document linkage,
  bounded bodies, and bounded document/label batches remain in place.

## Scholarly and frontend review

The captured HS 751 ATF text is compared character-for-character against browser
`textContent`, including leading/trailing whitespace and source markers. The
rendering uses escaped React text and bypasses wikitext normalization. Other
editions remain separate, with source links and revisions retained. A failed
first edition leaves tablet metadata and a deep-linked second edition usable.

Browser cases cover missing documents, unrelated versus missing items,
catalogue-wide findspot/period discovery beyond the first page, keyboard filter
selection, filter-preserving pagination with no repeated records, and a holding
list exceeding one 50-value option page. Existing anonymous/denied editing,
metadata editing, transcription creation/recovery, image/model, Unicode, and
navigation journeys remain in the complete suite.

## Findings raised during integration

1. Facet label-only matching regressed the existing `University of Jena` alias
   lookup. The catalogue implementation added bounded facet aliases; the
   original query remains in acceptance coverage.
2. Tablet discovery terms omitted P11 titles, item aliases, and P329/P10 inventory
   qualifiers. The catalogue implementation added those terms and migration of
   already scanned checkpoints.
3. Malformed revision timestamps should be explicit protocol failures. This was
   reported to the coordinator; adapter validation and regression coverage now
   reject them as edition-specific protocol failures.
4. The first full browser run exposed two stale fixture responses in Next's
   persistent development fetch cache. Their decoded payloads contained one
   holding while the updated fixture contained 61. Only those two ignored cache
   files were removed before repeating the suite. No test assertion or product
   filter was weakened to accommodate them.

No authorization bypass or unintended expansion of write eligibility was found.
Index freshness remains an operational concern: source membership/metadata can
change during or after a scan, and the RDF and search indexes are not one
transactional source. Completeness must stay qualified by policy and scan time.

## Validation

- `npm.cmd test -- src/lib/edit/corpus-boundary.test.ts`: 2 passed.
- Focused edit/auth/ATF/loading/eligibility tests: 19 files, 195 tests passed.
- Typechecking and focused ESLint passed after the new fixtures/tests.
- Initial focused corpus browser acceptance: 10 desktop/mobile tests passed.
- Complete browser rerun: **79 passed, 1 intentional desktop/mobile-only skip**
  in 1.3 minutes. All 16 new corpus desktop/mobile cases passed. The command was
  `npm.cmd run test:e2e -- --workers=2` with the Chrome executable override.
  Detailed output is in `.data/f-full-e2e-final.log` (ignored local artifact).
- The coordinator's final integrated validation, after timestamp, pagination
  version, return navigation, and release-provenance follow-ups: **353 unit tests
  passed; 81 deterministic browser tests passed with 1 intentional skip; 4 live
  read-only smoke tests passed**. The production Docker image built successfully
  and its Linux `npm ci` passed. Native Windows `npm ci` remains blocked by the
  missing C++ toolset; that environment limitation is not a passing install.

## Final integration follow-up

Agent F independently reviewed the coordinator's final changes without editing
their implementation. No significant security regression was found:

- Search links carry a validated scan timestamp. A changed index restarts at
  page 1 with filters retained and an explicit notice, avoiding silent pagination
  across different published versions.
- Record return destinations pass the existing normalized local-path sanitizer
  and are then restricted to `/browse` or `/browse?...`. External URLs, arbitrary
  application routes, and path-normalization tricks cannot become return links.
- `/api/version` returns only a sanitized 40-character commit SHA, eligibility
  policy, and validated discovery freshness/count. It exposes no credentials,
  deployment paths, or other environment values and makes no provider request.
- Nested tablet retries use Next's refetching `retry` callback with pending-state
  control. The unused legacy global facet scan has been removed from visitor
  requests; missing discovery indexes produce an explicit unavailable state.
- Docker test subnet and Chrome overrides are passed as structured arguments.
  Cleanup validates the resolved temporary directory and task prefix before
  recursive removal and continues to target only task-generated resources.

The default Playwright Chromium binary was absent locally. Browser acceptance
used the installed Chrome executable through the existing
`PLAYWRIGHT_EXECUTABLE_PATH` configuration. Network permission was required for
the application's existing Next font downloads; FactGrid calls remained isolated
behind anonymous, GET-only fixtures.
