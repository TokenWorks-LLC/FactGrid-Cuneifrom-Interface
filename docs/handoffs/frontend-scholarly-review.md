# Independent frontend and scholarly-content review

Reviewed 13 November 2026 by Agent E. E implemented the frontend and independently
reviewed Agent D's document resolver, ATF analyzer, and tests. Browser acceptance
is owned independently by Agent F; this review does not substitute for that run.

## Scholarly integrity

- `CDLI-ATF-L-Q{qid}` has an explicit edition kind. The resolver retains the
  fixed FactGrid origin and exact tablet-QID suffix checks.
- ATF recognition requires the exact title, one unambiguous poem container,
  a CDLI text identifier, an ATF directive, and a tablet directive. Ambiguous,
  hidden, or unrecognized content remains unsupported with its source link.
- The analyzer returns the exact source substring, including whitespace,
  braces, brackets, directives, line markers, and markup-like notation.
- Both the edition view and comparison view bypass wikitext cleanup for ATF.
  React escapes the displayed text; scholarly notation is not rendered as HTML.
- Each linked P251 statement remains a separate edition. Failed editions retain
  their array position and anchor. No title-based guessed documents are fetched.
- Every recognized ATF region is read-only. It cannot fall through to the D-page
  editor or the plain-text splice contract. Source revision ID, timestamp, page,
  and revision history remain visible.

No significant scholarly-integrity issue was found within this initial narrow
ATF read contract. Other ATF layouts remain intentionally unsupported rather than
being normalized or silently interpreted.

## Frontend follow-up findings

1. A preselected filter's QID fallback could overwrite a readable label returned
   by the catalogue API. Fixed by preferring the current API choice and retaining
   its label across value pages.
2. A selected value outside the first fifty values could retain a QID label when
   the results page had no corresponding record. Fixed by using the validated
   index's label map for the initial selected choice, without serializing the
   complete index into the client.
3. Lowercase QIDs in direct filter URLs were accepted by server normalization
   but not retained by the selector. Filter QIDs are now normalized consistently
   before rendering and generating pagination URLs.

Dropdowns contain at most fifty current-page choices plus the selected value.
Label search and explicit value pagination expose later choices. Native select
keyboard behavior, visible labels, live status, and mobile-sized controls are
preserved. One manual pending-protected source retry avoids automatic retry loops.

## Verification

The frontend implementation passed TypeScript route/type checking and focused
ESLint. ATF, transcript, and document regression tests were run independently;
the coordinator records the final integrated results and desktop/mobile browser
results in the main handoff report.

Known presentation limitation: supported record-read error and unsupported-item
states render explanatory application views with HTTP 200. Nonexistent items
retain Next's not-found response. No source failure is labelled as a missing item.
