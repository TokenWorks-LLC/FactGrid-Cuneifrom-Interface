import { describe, expect, it } from "vitest";

import { isAllowedEditTarget, isEditTargetEnabled, parseAllowedEditTargets } from "./targets";

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

describe("edit target contributor policy", () => {
  const reference = {
    kind: "d" as const,
    qid: "Q42" as const,
    title: "D-Q42",
    url: "https://database.factgrid.de/wiki/D-Q42",
  };

  it("allows a server-resolved target without a deployment list in authenticated mode", () => {
    expect(isEditTargetEnabled(reference, "authenticated", new Set())).toBe(true);
  });

  it("keeps exact target enforcement in restricted mode", () => {
    expect(isEditTargetEnabled(reference, "restricted", new Set())).toBe(false);
    expect(isEditTargetEnabled(reference, "restricted", parseAllowedEditTargets("Q42|D-Q42"))).toBe(true);
  });
});
