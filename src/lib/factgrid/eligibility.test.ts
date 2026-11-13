import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entityIsEditableTablet, entityIsReadableTablet } from "./eligibility";
import type { WikibaseEntity, WikibaseStatement } from "./types";

const statement = (id: string, rank: WikibaseStatement["rank"] = "normal"): WikibaseStatement => ({
  rank,
  mainsnak: { snaktype: "value", datavalue: { value: { id } } },
});

describe("verified tablet eligibility", () => {
  it("accepts the actual HS 751 entity independently of catalogue discovery", () => {
    const fixture = JSON.parse(readFileSync(`${process.cwd()}/tests/fixtures/factgrid/live-q894483-entity.json`, "utf8"));
    expect(entityIsReadableTablet(fixture.entities.Q894483)).toBe(true);
    expect(entityIsEditableTablet(fixture.entities.Q894483)).toBe(true);
  });

  it("accepts a valid statement among multiple classifications", () => {
    const entity = { type: "item", claims: { P2: [statement("Q5"), statement("Q512006")] } };
    expect(entityIsReadableTablet(entity)).toBe(true);
  });

  it.each<WikibaseEntity>([
    { type: "item", claims: { P2: [statement("Q5")] } },
    { type: "item", claims: { P2: [statement("Q512006", "deprecated")] } },
    { type: "item", claims: { P2: [{ mainsnak: { snaktype: "somevalue" } }] } },
    { type: "item", missing: true, claims: { P2: [statement("Q512006")] } },
    { type: "property", claims: { P2: [statement("Q512006")] } },
    { type: "item" },
  ])("rejects unrelated, missing, or inactive classifications: %j", (entity) => {
    expect(entityIsReadableTablet(entity)).toBe(false);
    expect(entityIsEditableTablet(entity)).toBe(false);
  });
});
