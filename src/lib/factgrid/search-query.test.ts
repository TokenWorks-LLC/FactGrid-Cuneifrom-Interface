import { describe, expect, it } from "vitest";

import { CUNEIFORM_CATALOGUE_QID } from "./constants";
import {
  adaptCirrusSearchQids,
  buildCirrusSearchExpression,
  buildFacetQuery,
} from "./search-query";
import { normalizeSearchInput } from "./validation";

describe("bounded FactGrid search contracts", () => {
  it("places catalogue membership and validated facets in the upstream search", () => {
    const input = normalizeSearchInput({
      q: `Prag" haswbstatement:P2=Q1`,
      collection: "q512014",
      findspot: "Q390036",
      period: "Q512151",
      language: "q123",
      workType: "Q456",
      material: "q789",
      page: 2,
      pageSize: 10,
    });
    const expression = buildCirrusSearchExpression(input);

    expect(expression).toContain(`haswbstatement:P2=${CUNEIFORM_CATALOGUE_QID}`);
    expect(expression).toContain("haswbstatement:P329=Q512014");
    expect(expression).toContain("haswbstatement:P695=Q390036");
    expect(expression).toContain("haswbstatement:P853=Q512151");
    expect(expression).toContain("haswbstatement:P18=Q123");
    expect(expression).toContain("haswbstatement:P121=Q456");
    expect(expression).toContain("haswbstatement:P401=Q789");
    expect(expression).toContain('"Prag\\""');
    expect(
      expression.split(/\s+/u).filter((token) => token.startsWith("haswbstatement:P2=")),
    ).toHaveLength(1);
  });

  it("rejects invalid metadata filters before building a search", () => {
    for (const filter of ["language", "workType", "material"] as const) {
      expect(() => normalizeSearchInput({ [filter]: 'Q1" haswbstatement:P2=Q2' })).toThrow(/valid FactGrid QID/i);
    }
  });

  it("uses bounded membership-restricted facets without global counts", () => {
    const query = buildFacetQuery("P329");
    expect(query).toContain("?item wdt:P2 wd:Q512006");
    expect(query).toContain("?item wdt:P329 ?value");
    expect(query).toContain("SELECT DISTINCT ?value");
    expect(query).toContain("LIMIT 200");
    expect(query).not.toMatch(/COUNT/i);
  });

  it("rejects malformed search result namespaces", () => {
    expect(() =>
      adaptCirrusSearchQids({ query: { search: [{ ns: 0, title: "D-Q499899" }] } }),
    ).toThrow(/malformed catalogue search result/i);
  });
});
