/**
 * Wikibase stores wbeditentity summaries as a provider-generated magic comment
 * followed by an autosummary and, when supplied, the caller's custom summary.
 * The autosummary/custom-summary boundary cannot be recovered after saving, so
 * attribution validates the operation marker instead of matching rendered text.
 */
export function isWikibaseEditEntityComment(comment: unknown): comment is string {
  return (
    typeof comment === "string" &&
    /^\/\* wbeditentity-update:(?:0\|)? \*\/[\s\S]*$/u.test(comment)
  );
}
