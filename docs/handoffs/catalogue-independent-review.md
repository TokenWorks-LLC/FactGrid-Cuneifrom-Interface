# Independent catalogue review

Reviewer: Agent B, 2026-11-13. Agent B implemented the server integration hooks,
but did not implement the catalogue index, generator, facet route, or pagination
validation reviewed here. All inspection and tests were read-only against FactGrid.

## Findings reported for correction

1. **Concurrent refreshes could damage publication.** The first generator used a
   shared `.tmp` filename and no process lock. Two scans could overwrite the same
   temporary/checkpoint files. Require an exclusive writer lock before provider
   requests and validate the final artifact before replacing the published index.
2. **Exhausted checkpoints could falsely advance freshness.** A repeat run with
   unchanged membership count reused old records/labels and assigned a new
   `generatedAt`. Require an explicit fresh scan for new freshness, or retain the
   completed scan timestamp when resuming an exhausted checkpoint.
3. **Checkpoint/publication validation was incomplete.** The first generator
   checked only outer checkpoint fields. Duplicate/out-of-order records, invalid
   labels, and inconsistent last keys could reach publication. Runtime validation
   also needed explicit string checks for record IDs and timestamps; regular
   expression and `Date.parse` coercion alone do not enforce those contracts.
4. **Search terms omitted displayed titles and holding inventory numbers.** The
   initial metadata query included labels, direct P10, and P692, but omitted P11
   and P10 qualifiers attached to active P329 statements. Those omissions could
   make a title shown by the application unsearchable after switching to the
   snapshot. Include both shapes and test them independently.

## Correction review

Agent B independently re-read the corrected generator and runtime validator.
All four significant findings above are resolved:

- An exclusive `.lock` file is acquired before provider requests; lock ownership
  is checked during exit cleanup. Atomic publication uses unique temporary files.
- Completed scan timestamps are preserved on exhausted-checkpoint reruns,
  including recovery after publication preceded checkpoint confirmation.
- Checkpoints and final publications validate every record, ordering boundary,
  count, label, alias, and timestamp before publication. Runtime validation now
  rejects coerced non-string IDs and dates. The serialized size is bounded to
  the runtime loader's 64 MB limit.
- Metadata queries include P11, aliases, and P10 qualifiers attached to active
  P329 statements. A bounded migration hydrates earlier checkpoint records with
  this expanded contract before publication.

The deterministic generator tests spawn the real CLI with a mocked provider,
cover failed metadata recovery, lock rejection, corrupt-checkpoint preservation,
freshness preservation, and the required metadata projection.

One minor operational edge was reported separately: migration from a legacy
checkpoint with `--max-batches 1` initially paused before performing any migration
work. Default budgets and the active full scan are unaffected; Agent C was asked
to permit one migration batch and add a regression test.

## Verified strengths

- Read eligibility is rechecked against current entities after snapshot selection;
  selected filters are also rechecked without pulling later entries across page
  boundaries.
- All six supported filters are applied before pagination in the index.
- Lexicographic QID keyset discovery uses the same ordering for the strict
  continuation predicate and provider ordering. QIDs are validated before query
  interpolation; query values cannot inject SPARQL.
- Discovery is bounded by batch size, maximum batches, timeout, and response size.
- Subclass closure is checked against the reviewed class policy before scanning.
- Snapshot facets deduplicate QIDs, resolve label fallbacks, and support paginated
  API results rather than silently truncating the facet universe.
- Runtime index loading coalesces concurrent reads and retains its last valid
  in-memory index when replacement validation fails.
- Unconfigured deployments explicitly report incomplete catalogue discovery.
- Page validation bounds arithmetic rather than imposing the former page-100 cap;
  the live fallback retains its separately verified provider restriction.

## Validation

Command:

```text
npm.cmd test -- src/lib/factgrid/catalogue-index.test.ts src/lib/factgrid/catalogue-index.server.test.ts src/lib/factgrid/catalogue-search.test.ts src/lib/factgrid/catalogue-refresh.test.ts
```

Result after correction review: **4 test files, 22 tests passed**. Tests cover policy and
completeness validation, duplicate ordering keys, combined filters, page 101,
off-page facets, missing labels, 2,500 facet values, unavailable indexes,
last-known-good replacement, server integration, safe pagination arithmetic,
CLI recovery, writer exclusion, corruption preservation, metadata projection,
and unchanged freshness on exhausted reruns.

## Remaining data-model limitation

The source does not provide a transaction spanning this scan. Start/end membership
counts detect many changes, but equal counts cannot prove no balanced additions
and removals occurred during the scan. Document the `startedAt`–`generatedAt`
interval and refresh policy; describe completeness as exhausted discovery under
the reviewed inclusion policy during that interval, not an atomic current copy
of all FactGrid data. Direct record loading remains authoritative and independent
of this discovery snapshot.

## Implementer follow-up on the minor edge

Agent C corrected one-batch migration budget accounting and added the spawned
CLI regression `makes progress migrating an exhausted legacy checkpoint with a
one-batch budget`. The subsequent focused run passed **23 tests in four files**;
focused ESLint and repository typechecking also passed. This follow-up records
the fix after Agent B's review; it does not change the independently reported
22-test result above.
