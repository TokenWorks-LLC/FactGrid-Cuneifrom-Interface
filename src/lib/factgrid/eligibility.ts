import { CUNEIFORM_CATALOGUE_QID } from "./constants";
import type { Qid, WikibaseEntity } from "./types";

/**
 * Verified 2026-11-13 against P3* Q512006: the closure currently contains only
 * Clay tablet itself. Extend this list only with verified class evidence and
 * regenerate the versioned catalogue index when the policy changes.
 */
export const READABLE_TABLET_CLASS_QIDS: readonly Qid[] = Object.freeze([
  CUNEIFORM_CATALOGUE_QID,
]);
export const TABLET_ELIGIBILITY_POLICY = "clay-tablet-p2-p3-v1" as const;

function hasActiveClass(entity: WikibaseEntity, classes: readonly Qid[]): boolean {
  if (entity.missing || (entity.type !== undefined && entity.type !== "item")) return false;
  return (entity.claims?.P2 ?? []).some((statement) => {
    if (statement.rank === "deprecated" || statement.mainsnak?.snaktype !== "value") return false;
    const value = statement.mainsnak.datavalue?.value;
    if (!value || typeof value !== "object" || !("id" in value)) return false;
    return classes.some((qid) => qid === value.id);
  });
}

/** Read eligibility is independent of search-index discovery and user rights. */
export function entityIsReadableTablet(entity: WikibaseEntity): boolean {
  return hasActiveClass(entity, READABLE_TABLET_CLASS_QIDS);
}

/**
 * Keep the original exact-class mutation boundary even if verified read classes
 * expand later. This is eligibility only: OAuth, contributor, rights, CSRF,
 * target, revision and confirmation checks remain mandatory for every write.
 */
export function entityIsEditableTablet(entity: WikibaseEntity): boolean {
  return hasActiveClass(entity, [CUNEIFORM_CATALOGUE_QID]);
}
