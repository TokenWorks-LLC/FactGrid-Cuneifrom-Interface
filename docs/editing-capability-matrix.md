# Editing capability matrix

Status is based on the implementation and deterministic fixtures as of 29 September
2026. “Complete” means the stated bounded path is implemented and tested, not that a
live scholarly write has been performed.

| Capability | Status | Evidence and boundary |
|---|---|---|
| Authenticated editor access | Complete | Signed-out visitors see a sign-in message; loading, unavailable, disabled, denied, and failed-load states expose no draft controls. Desktop/mobile tests cover these states. |
| Existing plain local transcript update | Complete | Server-resolved P251 target, exact region splice, edit conflict parameters, `nocreate`, readback, and attribution checks. Only recognized plain `D-Q{qid}` regions qualify. |
| Create a missing canonical local transcript | Complete | Server derives `D-Q{qid}` and canonical wikitext, uses `createonly`, verifies readback, then links P251 with `baserevid`; upstream-state reconciliation covers accepted/unknown and concurrent outcomes. |
| Insert into an existing D page without a supported region | Partial | The page remains read-only. The service will not guess where to insert scholarly structure. |
| Multilingual labels, descriptions, aliases | Complete | Add, replace, and remove operations use base-revision conflict protection and authoritative readback. |
| Sitelinks | Partial | Titles can be added, changed, or removed. Existing badges are preserved but are not editable in this UI. |
| Statements, ranks, snak states, qualifiers, references | Complete | Stable hashes are validated in their statement/property/reference scope; exact duplicate additions are rejected before mutation while historical duplicates are preserved. Destructive changes require review confirmation; supported values use a bounded partial `wbeditentity` patch. P251 is read-only at every mainsnak, qualifier, reference, replacement, and removal boundary and is owned by the dedicated transcription workflows. |
| Property datatypes | Partial | Installed scalar, entity, time, quantity, coordinate, media, URL, external-id, geo-shape, and tabular-data forms are handled where safe. Unknown datatypes are explicit and read-only. |
| Restricted contributor deployment | Complete | Exact username and exact `QID|document title` allowlists plus current linkage, fresh rights, block state, OAuth grant, origin, CSRF, and rate-limit checks. |
| Authenticated contributor deployment | Complete | Explicit opt-in removes deployment allowlists, but retains current linkage/membership, fresh identity/rights/block/grant, origin, CSRF, validation, and conflict checks. |
| Dirty-draft and confirmation UX | Complete | Metadata, existing-transcription, and creation drafts are account/revision scoped; application links/logout are confirmed before action, unload remains guarded, and history/reload restores the correct draft. The metadata review uses a modal focus-trapping primitive. |
| Create new Wikibase tablet items | Missing | Intentionally outside product scope. |
| Durable local write journal / multi-replica reconciliation | Missing | FactGrid remains authoritative; recovery derives state from upstream. The app keeps no scholarly write database and supports one application instance. |
| Live FactGrid write acceptance | Missing | Requires an approved OAuth consumer, project-authorized contributor policy, and designated record. No live write was made in this implementation pass. |

## Acceptance evidence

- Unit and contract tests cover parsing, authorization, metadata patching,
  creation/linking, conflicts, readback, attribution, partial outcomes, and recovery.
- Deterministic Playwright tests cover signed-out access denial, eligible metadata, and creation
  journeys at desktop and mobile widths.
- Docker smoke tests cover the production image and isolated OAuth 1.0a/2.0 flows;
  the live browser smoke remains read-only and advisory.
