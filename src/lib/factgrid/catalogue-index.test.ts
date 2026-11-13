import { describe, expect, it } from "vitest";
import { parseCatalogueIndex, queryCatalogueIndex, searchCatalogueFacets, type CatalogueIndex } from "./catalogue-index";
import { TABLET_ELIGIBILITY_POLICY } from "./eligibility";
import { normalizeSearchInput } from "./validation";
import type { Qid } from "./types";

export function fixtureIndex(count = 3): CatalogueIndex {
  const records = Array.from({ length: count }, (_, n) => ({
    id: `Q${100000 + n}` as Qid, label: `Tablet ${n}`, terms: n === 2 ? "HS 751 P123456" : "",
    collection: [n === 2 ? "Q900" : "Q901"] as Qid[], findspot: ["Q902"] as Qid[],
    period: [n === 2 ? "Q903" : "Q904"] as Qid[], language: ["Q905"] as Qid[],
    workType: ["Q906"] as Qid[], material: ["Q907"] as Qid[],
  }));
  return { version: 1, policy: TABLET_ELIGIBILITY_POLICY, classes: ["Q512006"],
    startedAt: "2026-11-13T00:00:00Z", generatedAt: "2026-11-13T01:00:00Z", complete: true,
    sourceCount: count, records, labels: { Q900: "Hilprecht Collection", Q901: "Other collection", Q903: "Ur III" } };
}

describe("complete read-only catalogue index", () => {
  it("validates a complete matching-policy artifact", () => {
    expect(parseCatalogueIndex(fixtureIndex()).records).toHaveLength(3);
  });

  it.each([
    { complete: false }, { policy: "unreviewed" }, { classes: ["Q1"] },
    { sourceCount: 9 }, { generatedAt: "invalid" }, { version: 2 },
  ])("rejects partial or incompatible refreshes %j", (patch) => {
    expect(() => parseCatalogueIndex({ ...fixtureIndex(), ...patch })).toThrow();
  });

  it("rejects duplicate and out-of-order IDs", () => {
    const index = fixtureIndex();
    index.records[1].id = index.records[0].id;
    expect(() => parseCatalogueIndex(index)).toThrow(/ordering/);
  });

  it("rejects coerced IDs and dates instead of accepting malformed serialized values", () => {
    const index = fixtureIndex();
    expect(() => parseCatalogueIndex({ ...index, generatedAt: 1 })).toThrow();
    expect(() => parseCatalogueIndex({ ...index, records: [{ ...index.records[0], id: ["Q100000"] }] })).toThrow();
  });

  it("searches identifiers and applies combined filters before pagination", () => {
    const found = queryCatalogueIndex(fixtureIndex(), normalizeSearchInput({ q: "HS 751", collection: "Q900", period: "Q903", pageSize: 1 }));
    expect(found.qids).toEqual(["Q100002"]);
    expect(found.totalResults).toBe(1);
    expect(found.hasNextPage).toBe(false);
  });

  it("applies language, work type and material instead of silently dropping them", () => {
    for (const property of ["language", "workType", "material"]) {
      expect(queryCatalogueIndex(fixtureIndex(), normalizeSearchInput({ [property]: "Q999" })).qids).toEqual([]);
    }
  });

  it("provides stable disjoint pages beyond the former 100-page limit", () => {
    const index = fixtureIndex(2500);
    // This validates the index independently of the provider's 10k offset limit.
    const input = { q: "", pageSize: 20, page: 101 };
    const first = queryCatalogueIndex(index, input);
    const next = queryCatalogueIndex(index, { ...input, page: 102 });
    expect(first.qids).toHaveLength(20);
    expect(next.qids.some((id) => first.qids.includes(id))).toBe(false);
    expect(first.hasNextPage).toBe(true);
    expect(queryCatalogueIndex(index, { ...input, page: 126 }).hasNextPage).toBe(false);
  });

  it("discovers facets outside the first result page and deduplicates IDs", () => {
    const index = fixtureIndex();
    expect(queryCatalogueIndex(index, normalizeSearchInput({ pageSize: 1 })).qids).toEqual(["Q100000"]);
    expect(searchCatalogueFacets(index, "collection")).toHaveLength(2);
    expect(searchCatalogueFacets(index, "collection", "hilprecht").map((value) => value.id)).toEqual(["Q900"]);
    expect(searchCatalogueFacets(index, "period", "ur iii").map((value) => value.id)).toEqual(["Q903"]);
    expect(searchCatalogueFacets(index, "findspot")[0].label).toBe("Q902");
  });

  it("does not truncate high-cardinality discovery", () => {
    const index = fixtureIndex(2500);
    index.records.forEach((entry, n) => { entry.collection = [`Q${200000 + n}`]; });
    expect(searchCatalogueFacets(index, "collection")).toHaveLength(2500);
    expect(searchCatalogueFacets(index, "collection", "Q202499")).toHaveLength(1);
  });

  it("searches source aliases and alternate-language facet labels", () => {
    const index = fixtureIndex();
    index.labels.Q900 = "Friedrich-Schiller-University Jena";
    index.facetAliases = { Q900: ["University of Jena", "Universität Jena"] };
    expect(searchCatalogueFacets(index, "collection", "University of Jena").map((value) => value.id)).toEqual(["Q900"]);
    expect(searchCatalogueFacets(index, "collection", "Universität").map((value) => value.id)).toEqual(["Q900"]);
  });
});
