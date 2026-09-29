import { describe, expect, it } from "vitest";

import { parseEditionId } from "./validation";

describe("FactGrid edition statement identifiers", () => {
  it("preserves bounded opaque provider GUIDs with a case-insensitive owner prefix", () => {
    expect(parseEditionId("q42$historical_guid.with-provider-punctuation", "Q42")).toBe(
      "q42$historical_guid.with-provider-punctuation",
    );
  });

  it.each([
    "Q43$other-owner",
    "Q42-no-separator",
    "Q42$",
    `Q42$${"x".repeat(197)}`,
    "Q42$bad\u0000guid",
  ])("rejects an unsafe or wrong-owner GUID: %s", (value) => {
    expect(() => parseEditionId(value, "Q42")).toThrow(/not a valid P251 statement identifier/i);
  });
});
