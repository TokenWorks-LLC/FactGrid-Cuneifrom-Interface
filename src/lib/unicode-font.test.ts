import { describe, expect, it } from "vitest";

import { suggestedUnicodeFont } from "./unicode-font";

describe("Unicode font suggestion", () => {
  it("matches explicit period styles with common spacing and punctuation", () => {
    expect(suggestedUnicodeFont(["Old Babylonian"])).toBe("old-babylonian");
    expect(suggestedUnicodeFont(["Neo-Assyrian period"])).toBe("neo-assyrian");
  });

  it("keeps the general font when the period is absent, unrelated, or ambiguous", () => {
    expect(suggestedUnicodeFont([])).toBe("noto");
    expect(suggestedUnicodeFont(["Old Assyrian"])).toBe("noto");
    expect(suggestedUnicodeFont(["Old Babylonian", "Neo-Assyrian"])).toBe("noto");
  });
});
