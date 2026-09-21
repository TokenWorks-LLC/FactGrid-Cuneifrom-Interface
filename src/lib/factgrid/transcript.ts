import { FACTGRID_LIMITS } from "./constants";
import { FactGridError, FactGridInputError } from "./errors";
import type {
  DocumentReference,
  ParsedWikitextSection,
  TranscriptRegion,
} from "./types";

const POEM_OPEN = /<poem\b[^>]*>/gi;
const TARGET_POEM_CLOSE = /<\/poem\s*>/gi;
const STRUCTURAL_WIKITEXT =
  /(?:\{\{|\[\[|<!--|-->|__[A-Z][A-Z0-9_]*__|^\s*\{\||^\s*\|\}|<\/?(?:span|ref|table|tbody|thead|tr|td|th|div|nowiki|gallery|script|style|iframe|object|embed|form|input|textarea|button|a)\b)/im;
const STRUCTURED_TRANSCRIPT_ROWS =
  /(?:^[ \t]*P[0-9A-Za-z]+:[^\t\r\n]+\t)|(?:^[ \t]*\d+(?:[-.]\d+)?\t(?:[^\t\r\n]*\t){2,})/m;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** Extracts level 2–6 sections without rendering or trusting MediaWiki HTML. */
export function parseWikitextSections(source: string): ParsedWikitextSection[] {
  const headingPattern = /^(={2,6})\s*([^\r\n=].*?)\s*\1\s*$/gm;
  const headings = Array.from(source.matchAll(headingPattern));
  const sections = headings.map((heading, index) => {
    const contentStart = (heading.index ?? 0) + heading[0].length;
    const contentEnd = headings[index + 1]?.index ?? source.length;
    return {
      heading: heading[2].trim(),
      level: heading[1].length,
      wikitext: source.slice(contentStart, contentEnd).replace(/^\r?\n/, ""),
    };
  });
  const firstPoem = source.search(/<poem\b/iu);
  const preambleEnd = Math.min(
    headings[0]?.index ?? source.length,
    firstPoem >= 0 ? firstPoem : source.length,
  );
  const preamble = source.slice(0, preambleEnd).trim();
  return preamble
    ? [{ heading: "Source notes", level: 1, wikitext: preamble }, ...sections]
    : sections;
}

function hasTransliterationProperty(openingTag: string): boolean {
  const match = openingTag.match(/\bproperty\s*=\s*(?:"([^"]*)"|'([^']*)')/iu);
  const value = match?.[1] ?? match?.[2];
  return value
    ?.split(/\s+/u)
    .includes("http://www.purl.org/cuneiform/hasTransliteration") ?? false;
}

function isInsideExcludedWikitextContext(source: string, index: number): boolean {
  const context = source.slice(0, index);
  const prefix = context.toLowerCase();
  const insideTag = (tag: string) => {
    const tokens = context.matchAll(new RegExp(`<\\/?${tag}\\b[^>]*>`, "giu"));
    let depth = 0;
    for (const token of tokens) {
      if (/^<\//u.test(token[0])) depth = Math.max(0, depth - 1);
      else if (!/\/\s*>$/u.test(token[0])) depth += 1;
    }
    return depth > 0;
  };
  return (
    prefix.lastIndexOf("<!--") > prefix.lastIndexOf("-->") ||
    [
      "nowiki",
      "ref",
      "gallery",
      "table",
      "tbody",
      "thead",
      "tr",
      "td",
      "th",
      "div",
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "textarea",
    ].some(insideTag) ||
    prefix.lastIndexOf("{{") > prefix.lastIndexOf("}}") ||
    prefix.lastIndexOf("[[") > prefix.lastIndexOf("]]") ||
    prefix.lastIndexOf("{|") > prefix.lastIndexOf("|}")
  );
}

function isDirectlyInsideTranscriptSection(source: string, index: number): boolean {
  const headingPattern = /^(={2,6})\s*([^\r\n=].*?)\s*\1\s*$/gm;
  const headings = Array.from(source.matchAll(headingPattern));
  return headings.some((heading, headingIndex) => {
    if (!/^transcript(?:ion)?$|^transliteration$/iu.test(heading[2].trim())) return false;
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[headingIndex + 1]?.index ?? source.length;
    return (
      !isInsideExcludedWikitextContext(source, heading.index ?? -1) &&
      index >= start &&
      index < end &&
      /^\s*$/u.test(source.slice(start, index))
    );
  });
}

/**
 * Finds one exact hasTransliteration poem boundary, or one unambiguous poem in
 * a Transcript/Transliteration section. A verified D page can be editable when
 * either marker identifies one plain region; every write still requires the
 * current exact P251 statement and deployment target allowlist.
 */
export function analyzeTranscriptSource(
  reference: DocumentReference,
  source: string,
): TranscriptRegion | null {
  POEM_OPEN.lastIndex = 0;
  const allOpenings = Array.from(source.matchAll(POEM_OPEN));
  const eligibleOpenings = allOpenings.filter(
    (opening) => !isInsideExcludedWikitextContext(source, opening.index ?? -1),
  );
  const attributedOpenings = eligibleOpenings.filter((opening) =>
    hasTransliterationProperty(opening[0]),
  );
  const opening =
    attributedOpenings.length === 1
      ? attributedOpenings[0]
      : attributedOpenings.length === 0 &&
          eligibleOpenings.length === 1 &&
          isDirectlyInsideTranscriptSection(source, eligibleOpenings[0].index ?? -1)
        ? eligibleOpenings[0]
        : undefined;
  if (!opening) return null;

  const start = (opening.index ?? 0) + opening[0].length;
  TARGET_POEM_CLOSE.lastIndex = start;
  const closing = TARGET_POEM_CLOSE.exec(source);
  if (!closing || source.slice(start, closing.index).match(/<poem\b/i)) return null;

  const content = source.slice(start, closing.index);
  const mixed = STRUCTURAL_WIKITEXT.test(content);
  const structured = STRUCTURED_TRANSCRIPT_ROWS.test(content);
  const verifiedEditionKind = reference.kind === "d";
  const verifiedProperty = hasTransliterationProperty(opening[0]);
  const verifiedSection =
    eligibleOpenings.length === 1 &&
    isDirectlyInsideTranscriptSection(source, opening.index ?? -1);

  return {
    format: mixed ? "mixed-wikitext" : structured ? "structured-lines" : "plain-poem-v1",
    content,
    displayText: content.trim(),
    editable:
      !mixed &&
      !structured &&
      verifiedEditionKind &&
      (verifiedProperty || verifiedSection),
    start,
    end: closing.index,
    reason: mixed
      ? "This edition contains structured or mixed wikitext and is read-only."
      : structured
        ? "This token-column transcript is read-only."
        : !verifiedEditionKind
          ? "Only verified plain D-Q document pages are supported for editing."
          : !verifiedProperty && !verifiedSection
            ? "This poem is readable, but it is not uniquely identified by a transliteration marker or section."
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
  if (STRUCTURED_TRANSCRIPT_ROWS.test(replacement)) {
    throw new FactGridInputError(
      "Structured token rows are not supported by the plain transcript editor.",
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
