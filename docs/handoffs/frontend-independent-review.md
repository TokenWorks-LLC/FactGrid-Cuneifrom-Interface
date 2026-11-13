# Independent frontend source review

Reviewer: catalogue workstream (did not implement the frontend changes).
Date: 13 November 2026.

Reviewed `browse/page.tsx`, `browse/facet-select.tsx`, tablet record and edit pages,
`EditionDetails` and `ReadRetryButton`. This is a source and integration-contract
review; the independent QA workstream owns desktop/mobile browser observations.

No critical frontend issue was found in the reviewed changes.

- All six active filters remain in result-pagination URLs. Submitted filter names
  agree with server normalization and the facet API contract. Selected values
  outside the current option page remain present, and preselected URLs obtain
  readable labels from the complete index even when no record is visible.
- Native labelled selects, search inputs, buttons and details preserve ordinary
  keyboard interaction. Each select is associated with a live status description;
  option navigation buttons are non-submit buttons. A dropdown contains at most
  50 discovered values plus its retained selection, rather than the whole index.
- Name lookup is debounced, aborts superseded requests, preserves the selected
  value when browsing option pages, and exposes empty, loading and incomplete
  catalogue states. Missing-index empty lookups do not call FactGrid name search.
  Complete-index requests perform local bounded response paging and no SPARQL.
- Browse distinguishes an upstream read failure from a successful empty page.
  It displays the index date and provider fallback limit instead of implying
  complete discovery when no complete snapshot is available.
- Failed edition reads keep their numbered sections and source links. Other
  editions remain separate and accessible. The requested edition hash opens its
  native details element after hydration and on hash changes; the containing
  section exists even when its document failed, preserving anchor numbering.
- ATF content reaches an escaped `pre` without wikitext normalization. The edit
  gate requires a loaded `d` edition with an editable transcript, preserving the
  newly recognized ATF format's read-only presentation.
- Public record failures distinguish unsupported items, nonexistent items,
  temporary service failures and invalid upstream responses. Source links and
  explicit user-triggered retries remain available where appropriate. Metadata
  entity values link both to filtered browse URLs and to authoritative FactGrid.
- The visual changes use the existing typography, borders, spacing and responsive
  grid classes. The code retains wrapping layouts, bounded select option pages,
  horizontally scrollable/pre-wrapped text and minimum-height controls. Actual
  viewport and focus behavior still requires the QA browser results.

Two minor usability opportunities were reported to the coordinator: facet lookup
failure text says “Try again” without an explicit retry button (editing the
search or reloading retries); the existing “Back to catalogue” link resets the
query, whereas browser Back preserves the prior filter URL. Neither is an access,
data-integrity or authorization failure. The coordinator decides whether to add
these refinements before delivery.

The catalogue workstream's own new suites subsequently passed 23 tests in four
files. Focused ESLint and repository typechecking passed. The generator's
one-batch legacy migration starvation edge identified during the server
workstream's review was corrected and covered by a spawned-process regression.
