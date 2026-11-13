import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMediaWikiEditClient, saveTranscript } from "./factgrid-write";
import { createFactGridClient } from "@/lib/factgrid/server";
import { resolveFactGridDocumentUrl } from "@/lib/factgrid/documents";
import type { CatalogueIndex } from "@/lib/factgrid/catalogue-index";
import type { TabletEdition } from "@/lib/factgrid/types";

describe("expanded corpus write boundary", () => {
  it("rejects a verified ATF edition even for an authorized account and authenticated target policy", async () => {
    const source = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/factgrid/live-q894483-document.json"), "utf8"));
    const page = source.query.pages[0];
    const reference = resolveFactGridDocumentUrl("https://database.factgrid.de/wiki/CDLI-ATF-L-Q894483", "Q894483");
    if ("status" in reference) throw new Error("Invalid captured ATF reference");
    const edition: TabletEdition = { editionId: "Q894483$ATF", kind: "atf", label: "CDLI ATF transliteration", status: "linked", reference };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      curtimestamp: "2026-11-13T00:00:00Z",
      query: { userinfo: { id: 17, name: "Editor", rights: ["read", "edit"] }, tokens: { csrftoken: "provider-token" },
        pages: [{ ...page, protection: [], actions: { edit: true }, lastrevid: page.revisions[0].revid }] },
    }));
    const client = createMediaWikiEditClient({ fetch: fetchMock as typeof fetch });
    const submit = vi.fn(client.submitEdit);
    await expect(saveTranscript({
      qid: "Q894483", editionId: edition.editionId!, accessToken: "fixture-access", identity: { providerUserId: "17", username: "Editor" }, contributorPolicy: "authenticated",
      request: { baseRevision: 20109826, text: "replacement", summary: "Fixture only" },
    }, { factGrid: { resolveCurrentEdition: async () => edition }, mediaWiki: { ...client, submitEdit: submit } })).rejects.toMatchObject({ code: "unsupported_edition", status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not trust discovery-index inclusion to authorize reads, metadata edits or edition updates", async () => {
    const index: CatalogueIndex = {
      version: 1, policy: "clay-tablet-p2-p3-v1", classes: ["Q512006"], startedAt: "2026-11-13T00:00:00Z", generatedAt: "2026-11-13T00:00:01Z", complete: true, sourceCount: 1,
      records: [{ id: "Q42", label: "Unrelated", terms: "", collection: [], findspot: [], period: [], language: [], workType: [], material: [] }], labels: {},
    };
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ entities: { Q42: { id: "Q42", type: "item", lastrevid: 10, claims: {} } } }));
    const client = createFactGridClient({ fetch: fetchMock as typeof fetch, catalogueIndex: index });
    await expect(client.searchTablets()).resolves.toMatchObject({ results: [] });
    await expect(client.getTablet("Q42")).rejects.toMatchObject({ code: "NOT_IN_CATALOGUE" });
    await expect(client.getEditableTabletEntity("Q42")).rejects.toMatchObject({ code: "NOT_IN_CATALOGUE" });
    await expect(client.resolveCurrentEdition("Q42", "Q42$fake")).rejects.toMatchObject({ code: "NOT_IN_CATALOGUE" });
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  });
});
