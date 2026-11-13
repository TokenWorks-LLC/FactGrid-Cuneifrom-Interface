import { describe, expect, it, vi } from "vitest";
import type { WikibaseEntity } from "./types";

vi.mock("server-only", () => ({}));
import { createFactGridClient } from "./server";

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const itemValue = (id: string) => ({ rank: "normal" as const, mainsnak: { snaktype: "value", datavalue: { value: { id } } } });
function entity(documents = ["D-Q42", "CDLI-W-Q42"]): WikibaseEntity {
  return {
    id: "Q42", type: "item", lastrevid: 10,
    labels: { en: { value: "Reliable tablet" } },
    claims: {
      P2: [itemValue("Q512006")], P329: [itemValue("Q99")],
      P251: documents.map((title, index) => ({
        id: `Q42$DOC-${index}`, rank: "normal",
        mainsnak: { snaktype: "value", datavalue: { value: `https://database.factgrid.de/wiki/${title}` } },
      })),
    },
  };
}
const validPage = (title: string) => ({
  pageid: 3, ns: 0, title,
  revisions: [{ revid: 20, parentid: 19, timestamp: "2026-11-13T00:00:00Z", slots: { main: {
    contentmodel: "wikitext", contentformat: "text/x-wiki", content: "== Transcript ==\n<poem>\n1. a-na\n</poem>\n",
  } } }],
});

describe("tablet read failure boundaries", () => {
  it("keeps metadata, QID source links and editions when labels fail", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("ids") === "Q42") return response({ entities: { Q42: entity() } });
      if (url.searchParams.get("ids") === "Q99") return response({}, 503);
      return response({ query: { pages: [validPage("D-Q42"), validPage("CDLI-W-Q42")] } });
    });
    const record = await createFactGridClient({ fetch: fetchMock as typeof fetch }).getTablet("Q42");
    expect(record.title).toBe("Reliable tablet");
    expect(record.holdings).toEqual([{ id: "Q99", label: "Q99", url: "https://database.factgrid.de/wiki/Item:Q99" }]);
    expect(record.readWarnings).toMatchObject([{ resource: "labels", code: "UPSTREAM_UNAVAILABLE", retryable: true }]);
    expect(record.editions.map((edition) => edition.status)).toEqual(["loaded", "loaded"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    { name: "service failure", documentResponse: () => response({}, 503), code: "UPSTREAM_UNAVAILABLE" },
    { name: "malformed JSON", documentResponse: () => new Response("not json"), code: "UPSTREAM_PROTOCOL" },
    { name: "null JSON", documentResponse: () => response(null), code: "UPSTREAM_PROTOCOL" },
    { name: "array JSON", documentResponse: () => response([]), code: "UPSTREAM_PROTOCOL" },
    { name: "invalid revision response", documentResponse: () => response({ query: {} }), code: "UPSTREAM_PROTOCOL" },
  ])("shows edition-specific errors after $name without hiding metadata", async ({ documentResponse, code }) => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("ids") === "Q42") return response({ entities: { Q42: entity() } });
      if (url.searchParams.get("ids") === "Q99") return response({ entities: { Q99: { id: "Q99", missing: true } } });
      return documentResponse();
    });
    const record = await createFactGridClient({ fetch: fetchMock as typeof fetch }).getTablet("Q42");
    expect(record.qid).toBe("Q42");
    expect(record.editions).toHaveLength(2);
    for (const edition of record.editions) {
      expect(edition).toMatchObject({ status: "error", errorCode: code, retryable: true });
      expect(edition.reference?.url).toContain("database.factgrid.de/wiki/");
      expect(edition.revision).toBeUndefined();
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps edition order and good content when another revision is malformed or absent", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("ids") === "Q42") return response({ entities: { Q42: entity(["D-Q42", "CDLI-W-Q42", "ORACC-W-Q42", "UNICODE-W-Q42"]) } });
      if (url.searchParams.get("ids") === "Q99") return response({ entities: { Q99: { id: "Q99" } } });
      return response({ query: { pages: [
        validPage("D-Q42"), { ns: 0, title: "CDLI-W-Q42", revisions: [] },
        { ns: 0, title: "ORACC-W-Q42", missing: true },
      ] } });
    });
    const record = await createFactGridClient({ fetch: fetchMock as typeof fetch }).getTablet("Q42");
    expect(record.editions.map((edition) => edition.reference?.title)).toEqual(["D-Q42", "CDLI-W-Q42", "ORACC-W-Q42", "UNICODE-W-Q42"]);
    expect(record.editions.map((edition) => edition.status)).toEqual(["loaded", "error", "missing", "error"]);
    expect(record.editions[0].revision?.transcript?.displayText).toBe("1. a-na");
    expect(record.editions[3].errorCode).toBe("UPSTREAM_PROTOCOL");
  });

  it("does not construct or fetch unlinked candidate documents", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("ids") === "Q42") return response({ entities: { Q42: entity([]) } });
      return response({ entities: { Q99: { id: "Q99" } } });
    });
    expect((await createFactGridClient({ fetch: fetchMock as typeof fetch }).getTablet("Q42")).editions).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects conflicting duplicate revision titles without hiding other editions", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("ids") === "Q42") return response({ entities: { Q42: entity() } });
      if (url.searchParams.get("ids") === "Q99") return response({ entities: { Q99: { id: "Q99" } } });
      return response({ query: { pages: [validPage("D-Q42"), validPage("D-Q42"), validPage("CDLI-W-Q42")] } });
    });
    const record = await createFactGridClient({ fetch: fetchMock as typeof fetch }).getTablet("Q42");
    expect(record.editions[0]).toMatchObject({ status: "error", errorCode: "UPSTREAM_PROTOCOL" });
    expect(record.editions[1].status).toBe("loaded");
  });

  it("reports malformed revision attribution without hiding another edition", async () => {
    const bad = validPage("D-Q42");
    bad.revisions[0].timestamp = "not-a-date";
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.searchParams.get("ids") === "Q42") return response({ entities: { Q42: entity() } });
      if (url.searchParams.get("ids") === "Q99") return response({ entities: { Q99: { id: "Q99" } } });
      return response({ query: { pages: [bad, validPage("CDLI-W-Q42")] } });
    });
    const record = await createFactGridClient({ fetch: fetchMock as typeof fetch }).getTablet("Q42");
    expect(record.editions[0]).toMatchObject({ status: "error", errorCode: "UPSTREAM_PROTOCOL" });
    expect(record.editions[1].status).toBe("loaded");
  });

  it("keeps core failures fatal and distinct from missing or ineligible items", async () => {
    const unavailable = createFactGridClient({ fetch: vi.fn(async () => response({}, 503)) as typeof fetch });
    await expect(unavailable.getTablet("Q42")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const missing = createFactGridClient({ fetch: vi.fn(async () => response({ entities: { Q42: { id: "Q42", missing: true } } })) as typeof fetch });
    await expect(missing.getTablet("Q42")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const unrelated = createFactGridClient({ fetch: vi.fn(async () => response({ entities: { Q42: { id: "Q42", claims: {} } } })) as typeof fetch });
    await expect(unrelated.getTablet("Q42")).rejects.toMatchObject({ code: "NOT_IN_CATALOGUE" });
  });

  it("isolates a document timeout with no automatic retry loop", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("ids") === "Q42") return response({ entities: { Q42: entity() } });
      if (url.searchParams.get("ids") === "Q99") return response({ entities: { Q99: { id: "Q99" } } });
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    });
    const record = await createFactGridClient({ fetch: fetchMock as typeof fetch, timeoutMs: 10 }).getTablet("Q42");
    expect(record.editions[0]).toMatchObject({ status: "error", errorCode: "UPSTREAM_TIMEOUT", retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
