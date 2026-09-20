import type { DocumentReference } from "@/lib/factgrid/types";

const QID_PATTERN = /^Q[1-9][0-9]{0,14}$/;
const DOCUMENT_TITLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.() -]{0,180}$/;

function targetKey(qid: string, title: string): string {
  return `${qid}\0${title}`;
}

/**
 * Parse exact `QID|Document title` pairs. Invalid entries are never widened or
 * partially accepted, so an empty or malformed setting safely permits no page.
 */
export function parseAllowedEditTargets(value: string | undefined): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const entry of (value ?? "").split(",")) {
    const parts = entry.trim().split("|");
    if (parts.length !== 2) continue;
    const [qid, title] = parts;
    if (
      !QID_PATTERN.test(qid) ||
      !DOCUMENT_TITLE_PATTERN.test(title) ||
      title.includes("  ") ||
      !title.endsWith(`-${qid}`)
    ) {
      continue;
    }
    targets.add(targetKey(qid, title));
  }
  return targets;
}

export function isAllowedEditTarget(
  reference: DocumentReference,
  targets: ReadonlySet<string>,
): boolean {
  return targets.has(targetKey(reference.qid, reference.title));
}
