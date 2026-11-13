import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createFactGridClient } from "./server";
import { TABLET_ELIGIBILITY_POLICY } from "./eligibility";
import type { CatalogueIndex } from "./catalogue-index";
import type { Qid, WikibaseStatement } from "./types";
import { normalizeSearchInput } from "./validation";

const statement = (id: Qid): WikibaseStatement => ({ rank: "normal", mainsnak: { snaktype: "value", datavalue: { type: "wikibase-entityid", value: { id } } } });

function setup(count = 2500) {
  const records = Array.from({ length: count }, (_, n) => ({ id: `Q${100000 + n}` as Qid, label: `Tablet ${n}`, terms: "", collection: ["Q900"] as Qid[], findspot: ["Q901"] as Qid[], period: ["Q902"] as Qid[], language: [] as Qid[], workType: [] as Qid[], material: [] as Qid[] }));
  const index: CatalogueIndex = { version: 1, policy: TABLET_ELIGIBILITY_POLICY, classes: ["Q512006"], startedAt: "2026-11-13T00:00:00Z", generatedAt: "2026-11-13T01:00:00Z", complete: true, sourceCount: count, records, labels: {} };
  const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    expect(url.searchParams.get("action")).toBe("wbgetentities");
    const entities = Object.fromEntries(url.searchParams.get("ids")!.split("|").map((id) => [id, {
      id, type: "item", labels: { en: { value: `Tablet ${id}` } },
      claims: { P2: [statement("Q512006")], P329: [statement("Q900")], P695: [statement("Q901")], P853: [statement("Q902")] },
    }]));
    return new Response(JSON.stringify({ entities }), { headers: { "content-type": "application/json" } });
  });
  return { index, fetchMock, client: createFactGridClient({ fetch: fetchMock as typeof fetch, catalogueIndex: index }) };
}

describe("snapshot search integration", () => {
  it("normalizes and opens page101 without a search provider offset", async () => {
    const { client, fetchMock } = setup();
    expect(normalizeSearchInput({ page: 101 }).page).toBe(101);
    const first = await client.searchTablets({ page: 101 });
    const second = await client.searchTablets({ page: 102 });
    expect(first.results).toHaveLength(20);
    expect(first.results[0].qid).toBe("Q102000");
    expect(second.results[0].qid).toBe("Q102020");
    expect(first.catalogue).toMatchObject({ source: "snapshot", complete: true, totalResults: 2500 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("applies combined offpage filters before slicing and rechecks authoritative values", async () => {
    const { client, index } = setup();
    index.records.slice(0, 2499).forEach((entry) => { entry.collection = ["Q999"]; });
    const page = await client.searchTablets({ collection: "Q900", findspot: "Q901", period: "Q902", pageSize: 1 });
    expect(page.results.map((entry) => entry.qid)).toEqual(["Q102499"]);
    expect(page.hasNextPage).toBe(false);
    expect(page.catalogue?.totalResults).toBe(1);
  });

  it("rejects unsafe page arithmetic and distinguishes provider offset limits", async () => {
    expect(() => normalizeSearchInput({ page: Number.MAX_SAFE_INTEGER, pageSize: 25 })).toThrow();
    const fetchMock = vi.fn();
    const client = createFactGridClient({ fetch: fetchMock as typeof fetch, catalogueIndex: false });
    await expect(client.searchTablets({ page: 501 })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("restarts safely with the same filters when the published index changes between pages", async () => {
    const { client, index } = setup();
    const page = await client.searchTablets({ page: 101, collection: "Q900", period: "Q902",
      catalogueVersion: "2026-11-12T01:00:00Z" });
    expect(page.page).toBe(1);
    expect(page.results[0].qid).toBe(index.records[0].id);
    expect(page.catalogue).toMatchObject({ restarted: true, generatedAt: index.generatedAt, totalResults: 2500 });
    const next = await client.searchTablets({ page: 2, collection: "Q900", period: "Q902",
      catalogueVersion: index.generatedAt });
    expect(next.page).toBe(2);
    expect(next.catalogue?.restarted).toBeUndefined();
    expect(next.results.some((entry) => page.results.some((previous) => previous.qid === entry.qid))).toBe(false);
    expect(() => normalizeSearchInput({ catalogueVersion: "invalid" })).toThrow();
  });
});
