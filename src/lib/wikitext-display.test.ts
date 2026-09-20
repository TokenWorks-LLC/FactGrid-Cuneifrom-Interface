import { describe, expect, it } from "vitest";

import { wikitextToPlainText } from "./wikitext-display";

describe("wikitextToPlainText", () => {
  it("keeps useful label text while removing common wiki presentation syntax", () => {
    expect(
      wikitextToPlainText(
        "'''Heading'''\n[[Item:Q1|Akkadian]]<br />[https://example.org Source]{{small|hidden}}",
      ),
    ).toBe("Heading\nAkkadian\nSource");
  });

  it("returns inert text for hostile HTML rather than renderable markup", () => {
    const result = wikitextToPlainText(
      '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">link</a>',
    );

    expect(result).not.toContain("<");
    expect(result).not.toContain("javascript:");
    expect(result).toContain("link");
  });

  it("removes table control rows and normalizes surrounding whitespace", () => {
    expect(wikitextToPlainText("Line one  \n| style=row\n! Header\n\n\nLine two")).toBe(
      "Line one\n\nLine two",
    );
  });
});
