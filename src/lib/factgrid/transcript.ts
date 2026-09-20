import { FACTGRID_LIMITS } from "./constants";
import { FactGridError, FactGridInputError } from "./errors";
import type {
  DocumentReference,
  ParsedWikitextSection,
  TranscriptRegion,
} from "./types";

const TARGET_POEM_OPEN = /<poem\b[^>]*\bhasTransliteration\b[^>]*>/gi;
const TARGET_POEM_CLOSE = /<\/poem\s*>/gi;
const STRUCTURAL_WIKITEXT =
  /(?:\{\{|\[\[|^\s*\{\||^\s*\|\}|<\/?(?:span|ref|table|tbody|thead|tr|td|th|div)\b)/im;
const STRUCTURED_TRANSCRIPT_ROWS =
  /(?:^P[0-9A-Za-z]+:[^\t\r\n]+\t)|(?:^\d+(?:[-.]\d+)?\t(?:[^\t\r\n]*\t){2,})/m;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Extracts level 2–6 sections without rendering or trusting MediaWiki HTML. */
export function parseWikitextSections(source: string): ParsedWikitextSection[] {
  const headingPattern = /^(={2,6})\s*([^\r\n=].*?)\s*\1\s*$/gm;
  const headings = Array.from(source.matchAll(headingPattern));

  return headings.map((heading, index) => {
    const contentStart = (heading.index ?? 0) + heading[0].length;
    const contentEnd = headings[index + 1]?.index ?? source.length;
    return {
      heading: heading[2].trim(),
      level: heading[1].length,
      wikitext: source.slice(contentStart, contentEnd).replace(/^\r?\n/, ""),
    };
  });
}

/**
 * Finds one exact hasTransliteration poem boundary. Mixed D-pages are readable
 * but deliberately not editable; simple derived edition pages can be spliced.
 */
export function analyzeTranscriptSource(
  reference: DocumentReference,
  source: string,
): TranscriptRegion | null {
  TARGET_POEM_OPEN.lastIndex = 0;
  const openings = Array.from(source.matchAll(TARGET_POEM_OPEN));
  if (openings.length !== 1) return null;

  const opening = openings[0];
  const start = (opening.index ?? 0) + opening[0].length;
  TARGET_POEM_CLOSE.lastIndex = start;
  const closing = TARGET_POEM_CLOSE.exec(source);
  if (!closing || source.slice(start, closing.index).match(/<poem\b/i)) return null;

  const content = source.slice(start, closing.index);
  const mixed = STRUCTURAL_WIKITEXT.test(content);
  const structured = STRUCTURED_TRANSCRIPT_ROWS.test(content);
  const verifiedEditionKind = reference.kind === "d";

  return {
    format: mixed ? "mixed-wikitext" : structured ? "structured-lines" : "plain-poem-v1",
    content,
    displayText: content.trim(),
    editable: !mixed && !structured && verifiedEditionKind,
    start,
    end: closing.index,
    reason: mixed
      ? "This edition contains structured or mixed wikitext and is read-only."
      : structured
        ? "This token-column transcript is read-only."
      : !verifiedEditionKind
        ? "Only verified plain D-Q document pages are supported for editing."
        : undefined,
  };
}

export function validatePlainTranscriptReplacement(replacement: string): void {
  if (typeof replacement !== "string") {
    throw new FactGridInputError("Transcript content must be text.");
  }
  if (utf8Length(replacement) > FACTGRID_LIMITS.maxTranscriptBytes) {
    throw new FactGridInputError("Transcript content is too large.");
  }
  if (/\u0000|<\/poem\s*>|<poem\b/i.test(replacement)) {
    throw new FactGridInputError("Transcript content contains a forbidden poem boundary.");
  }
  if (STRUCTURAL_WIKITEXT.test(replacement)) {
    throw new FactGridInputError(
      "Structured wiki markup is not supported by the plain transcript editor.",
    );
  }
}

/** Replaces only the previously verified region and preserves every other byte. */
export function spliceTranscriptSource(
  source: string,
  region: TranscriptRegion,
  replacement: string,
): string {
  if (!region.editable || region.format !== "plain-poem-v1") {
    throw new FactGridError(
      "UNSUPPORTED_DOCUMENT",
      "This transcript format is read-only.",
      { status: 409 },
    );
  }
  if (
    !Number.isSafeInteger(region.start) ||
    !Number.isSafeInteger(region.end) ||
    region.start < 0 ||
    region.end < region.start ||
    source.slice(region.start, region.end) !== region.content
  ) {
    throw new FactGridError(
      "TRANSCRIPT_CONFLICT",
      "The source no longer matches the transcript that was opened.",
      { status: 409 },
    );
  }

  validatePlainTranscriptReplacement(replacement);
  return source.slice(0, region.start) + replacement + source.slice(region.end);
}
