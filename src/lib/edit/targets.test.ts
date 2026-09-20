import { describe, expect, it } from "vitest";

import { isAllowedEditTarget, parseAllowedEditTargets } from "./targets";

const reference = {
  kind: "unicode" as const,
  qid: "Q42" as const,
  title: "UNICODE-W-Q42",
  url: "https://database.factgrid.de/wiki/UNICODE-W-Q42",
};

describe("edit target allowlist", () => {
  it("defaults to deny and matches exact QID/title pairs", () => {
    expect(isAllowedEditTarget(reference, parseAllowedEditTargets(undefined))).toBe(false);
    expect(
      isAllowedEditTarget(
        reference,
        parseAllowedEditTargets("Q42|UNICODE-W-Q42,Q43|D-Q43"),
      ),
    ).toBe(true);
    expect(
      isAllowedEditTarget(reference, parseAllowedEditTargets("Q42|UNICODE-W-Q43")),
    ).toBe(false);
    expect(
      isAllowedEditTarget(reference, parseAllowedEditTargets("q42|UNICODE-W-Q42")),
    ).toBe(false);
  });
});
