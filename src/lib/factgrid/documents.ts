import { FACTGRID } from "./constants";
import type {
  DocumentReference,
  EditionKind,
  InvalidDocumentReference,
  Qid,
} from "./types";

const SAFE_DOCUMENT_TITLE = /^[A-Za-z0-9][A-Za-z0-9_.() -]{0,180}$/;

function editionKind(title: string, qid: Qid): EditionKind {
  if (title === `D-${qid}`) return "d";
  if (title === `CDLI-W-${qid}`) return "cdli";
  if (title === `ORACC-W-${qid}`) return "oracc";
  if (title === `UNICODE-W-${qid}`) return "unicode";
  return "other";
}

/**
 * Resolve only exact, main-namespace document links on FactGrid itself.
 * The title must belong to the supplied tablet QID; no redirect is followed.
 */
export function resolveFactGridDocumentUrl(
  rawValue: string,
  qid: Qid,
): DocumentReference | InvalidDocumentReference {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    return { status: "invalid", reason: "untrusted-url" };
  }

  if (
    parsed.origin !== FACTGRID.origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.pathname.startsWith("/wiki/")
  ) {
    return { status: "invalid", reason: "untrusted-url" };
  }

  let title: string;
  try {
    title = decodeURIComponent(parsed.pathname.slice("/wiki/".length)).replaceAll("_", " ");
  } catch {
    return { status: "invalid", reason: "invalid-title" };
  }

  if (!SAFE_DOCUMENT_TITLE.test(title) || title.includes("  ")) {
    return { status: "invalid", reason: "invalid-title" };
  }

  if (!title.endsWith(`-${qid}`)) {
    return { status: "invalid", reason: "wrong-record" };
  }

  return {
    kind: editionKind(title, qid),
    qid,
    title,
    url: `${FACTGRID.wikiBase}${encodeURIComponent(title).replaceAll("%20", "_")}`,
  };
}

export function editionLabel(kind: EditionKind): string {
  switch (kind) {
    case "d":
      return "Scholarly edition";
    case "cdli":
      return "CDLI transliteration";
    case "oracc":
      return "ORACC transliteration";
    case "unicode":
      return "Cuneiform Unicode";
    default:
      return "FactGrid edition";
  }
}
