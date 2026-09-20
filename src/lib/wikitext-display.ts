import sanitizeHtml from "sanitize-html";

/**
 * Produces readable plain text from a limited wikitext fragment. It is display
 * only: edits always use the untouched authoritative source and byte offsets.
 */
export function wikitextToPlainText(source: string): string {
  let value = source
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<ref\b[^>]*>([\s\S]*?)<\/ref\s*>/giu, " [$1]")
    .replace(/<ref\b[^>]*\/>/giu, "")
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/gu, "$1")
    .replace(/\[(https?:\/\/[^\s\]]+)\s+([^\]]+)\]/gu, "$2")
    .replace(/\[(https?:\/\/[^\]]+)\]/gu, "$1")
    .replace(/'{2,5}/gu, "");

  // Remove shallow presentation templates. Nested/semantic source is still
  // available through the edition link; it is never rewritten from this text.
  for (let pass = 0; pass < 3; pass += 1) {
    value = value.replace(/\{\{[^{}]*\}\}/gu, "");
  }

  value = sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} });
  return value
    .replace(/^\s*[|!].*$/gmu, "")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
