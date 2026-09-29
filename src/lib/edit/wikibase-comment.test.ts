import { describe, expect, it } from "vitest";

import { isWikibaseEditEntityComment } from "./wikibase-comment";

describe("Wikibase edit-entity comments", () => {
  it.each([
    "/* wbeditentity-update: */",
    "/* wbeditentity-update:0| */ Item changed, custom Unicode summary 𒀭",
  ])("accepts the anchored provider operation marker: %s", (comment) => {
    expect(isWikibaseEditEntityComment(comment)).toBe(true);
  });

  it.each([
    "custom summary",
    "prefix /* wbeditentity-update:0| */ custom summary",
    "/* wbsetlabel-set:1|en */ value, custom summary",
    "/* wbeditentity-update:1|en */ value",
  ])("does not infer attribution from unrelated or embedded text: %s", (comment) => {
    expect(isWikibaseEditEntityComment(comment)).toBe(false);
  });
});
