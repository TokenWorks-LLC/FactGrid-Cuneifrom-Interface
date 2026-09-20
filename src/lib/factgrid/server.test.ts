import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createFactGridClient } from "./server";
import { FactGridError } from "./errors";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function catalogueEntity(qid: string) {
  return {
    id: qid,
    labels: { en: { language: "en", value: `Fixture ${qid}` } },
    claims: {
      P2: [{
        rank: "normal",
        mainsnak: {
          snaktype: "value",
          datavalue: { value: { id: "Q512006" }, type: "wikibase-entityid" },
        },
      }],
    },
  };
}

describe("FactGrid server search", () => {
  it("returns an empty page only for a valid empty upstream result", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ batchcomplete: true, query: { search: [] } }));
    const client = createFactGridClient({
      fetch: fetchMock as typeof fetch,
      revalidateSeconds: false,
    });

    await expect(client.searchTablets({ pageSize: 5 })).resolves.toEqual({
      results: [],
      page: 1,
      pageSize: 5,
      hasNextPage: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requests bounded stable pagination and reports a next page", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("list") === "search") {
        expect(url.searchParams.get("sroffset")).toBe("1");
        expect(url.searchParams.get("srlimit")).toBe("2");
        expect(url.searchParams.get("srsort")).toBe("create_timestamp_asc");
        return jsonResponse({
          continue: { sroffset: 3, continue: "-||" },
          query: {
            search: [
              { ns: 120, pageid: 1, title: "Item:Q9000001" },
              { ns: 120, pageid: 2, title: "Item:Q9000002" },
            ],
          },
        });
      }
      return jsonResponse({
        success: 1,
        entities: {
          Q9000001: catalogueEntity("Q9000001"),
          Q9000002: catalogueEntity("Q9000002"),
        },
      });
    });
    const client = createFactGridClient({
      fetch: fetchMock as typeof fetch,
      revalidateSeconds: false,
    });
    const result = await client.searchTablets({ page: 2, pageSize: 1 });

    expect(result.results.map((entry) => entry.qid)).toEqual(["Q9000001"]);
    expect(result.hasNextPage).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps upstream failure distinct from an empty result", async () => {
    const client = createFactGridClient({
      fetch: vi.fn(async () => jsonResponse({ error: "unavailable" }, 503)) as typeof fetch,
      revalidateSeconds: false,
    });

    await expect(client.searchTablets()).rejects.toMatchObject<Partial<FactGridError>>({
      code: "UPSTREAM_UNAVAILABLE",
      status: 502,
    });
  });

  it("stops reading a chunked response once the byte budget is exceeded", async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.enqueue(new Uint8Array(128));
        controller.close();
      },
    });
    const client = createFactGridClient({
      fetch: vi.fn(async () => new Response(oversized, { status: 200 })) as typeof fetch,
      maxResponseBytes: 64,
      revalidateSeconds: false,
    });

    await expect(client.searchTablets()).rejects.toMatchObject<Partial<FactGridError>>({
      code: "UPSTREAM_RESPONSE_TOO_LARGE",
    });
  });

  it("preserves page boundaries when stale membership is removed", async () => {
    const staleEntity = { id: "Q9000001", labels: {}, claims: {} };
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("list") === "search") {
        expect(init?.cache).toBe("no-store");
        expect(new Headers(init?.headers).get("user-agent")).toContain(
          "FactGrid-Cuneiform-Interface",
        );
        return jsonResponse({
          query: {
            search: [
              { ns: 120, pageid: 1, title: "Item:Q9000001" },
              { ns: 120, pageid: 2, title: "Item:Q9000002" },
            ],
          },
        });
      }
      return jsonResponse({
        success: 1,
        entities: {
          Q9000001: staleEntity,
          Q9000002: catalogueEntity("Q9000002"),
        },
      });
    });
    const client = createFactGridClient({ fetch: fetchMock as typeof fetch });

    const result = await client.searchTablets({ pageSize: 1 });

    expect(result.results).toEqual([]);
    expect(result.hasNextPage).toBe(true);
  });
});

describe("FactGrid document loading", () => {
  it("loads multiple P251 pages without the single-title rvlimit parameter", async () => {
    let calls = 0;
    const entity = {
      ...catalogueEntity("Q9000003"),
      claims: {
        ...catalogueEntity("Q9000003").claims,
        P251: ["D-Q9000003", "CDLI-W-Q9000003"].map((title, index) => ({
          id: `Q9000003$DOC-${index}`,
          rank: "normal",
          mainsnak: {
            snaktype: "value",
            datavalue: {
              value: `https://database.factgrid.de/wiki/${title}`,
              type: "string",
            },
          },
        })),
      },
    };
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      calls += 1;
      const url = new URL(String(input));
      if (calls === 1) {
        return jsonResponse({ success: 1, entities: { Q9000003: entity } });
      }

      expect(url.searchParams.get("titles")).toBe("D-Q9000003|CDLI-W-Q9000003");
      expect(url.searchParams.has("rvlimit")).toBe(false);
      return jsonResponse({
        query: {
          pages: [
            { pageid: 11, ns: 0, title: "D-Q9000003", missing: true },
            { pageid: 12, ns: 0, title: "CDLI-W-Q9000003", missing: true },
          ],
        },
      });
    });
    const client = createFactGridClient({
      fetch: fetchMock as typeof fetch,
      revalidateSeconds: false,
    });

    const result = await client.getTablet("Q9000003");

    expect(result.editions).toHaveLength(2);
    expect(result.editions.every((edition) => edition.status === "missing")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
