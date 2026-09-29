import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EditableTabletEntity } from "@/lib/factgrid/types";

import { saveMetadata, type MetadataMutationClient } from "./metadata-write";

function snapshot(revision: number, label: string): EditableTabletEntity {
  return {
    entity: {
      id: "Q42",
      type: "item",
      lastrevid: revision,
      labels: { en: { language: "en", value: label } },
      descriptions: { de: { language: "de", value: "untouched" } },
      aliases: {},
      sitelinks: {},
      claims: {
        P2: [{
          id: "Q42$member",
          type: "statement",
          rank: "normal",
          mainsnak: {
            snaktype: "value",
            property: "P2",
            datatype: "wikibase-item",
            datavalue: {
              type: "wikibase-entityid",
              value: { "entity-type": "item", "numeric-id": 512006, id: "Q512006" },
            },
          },
        }],
      },
    },
    properties: {
      P2: { id: "P2", datatype: "wikibase-item", labels: {}, descriptions: {} },
    },
  };
}

describe("metadata save service", () => {
  it("submits only the requested partial patch and confirms readback", async () => {
    const before = snapshot(100, "Old");
    const after = snapshot(101, "New");
    const getEditableTabletEntity = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const mutationClient: MetadataMutationClient = {
      inspect: vi.fn().mockResolvedValue({
        csrfToken: "provider-token",
        requestStartedAt: "2026-09-29T08:00:00Z",
        expectedUsername: "Editor",
        expectedUserId: "17",
      }),
      submit: vi.fn().mockResolvedValue(101),
      confirmAttribution: vi.fn().mockResolvedValue(undefined),
    };

    const result = await saveMetadata({
      qid: "Q42",
      accessToken: "access",
      identity: { providerUserId: "17", username: "Editor" },
      request: {
        baseRevision: 100,
        summary: "Rename",
        confirmRemovals: false,
        confirmCatalogueRemoval: false,
        operations: [{ type: "set-label", language: "en", value: "New" }],
      },
    }, { factGrid: { getEditableTabletEntity }, mutationClient });

    expect(result.revisionId).toBe(101);
    expect(mutationClient.submit).toHaveBeenCalledWith(
      "access",
      "Q42",
      100,
      "Rename",
      { labels: { en: { language: "en", value: "New" } } },
      expect.objectContaining({ expectedUsername: "Editor" }),
    );
    expect(mutationClient.confirmAttribution).toHaveBeenCalled();
  });

  it("rejects a stale browser revision before inspecting or writing", async () => {
    const mutationClient: MetadataMutationClient = {
      inspect: vi.fn(),
      submit: vi.fn(),
      confirmAttribution: vi.fn(),
    };
    await expect(saveMetadata({
      qid: "Q42",
      accessToken: "access",
      identity: { providerUserId: "17", username: "Editor" },
      request: {
        baseRevision: 99,
        summary: "Rename",
        confirmRemovals: false,
        confirmCatalogueRemoval: false,
        operations: [{ type: "set-label", language: "en", value: "New" }],
      },
    }, {
      factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(snapshot(100, "Old")) },
      mutationClient,
    })).rejects.toMatchObject({ code: "edit_conflict", status: 409 });
    expect(mutationClient.inspect).not.toHaveBeenCalled();
    expect(mutationClient.submit).not.toHaveBeenCalled();
  });

  it("reads back a confirmed catalogue removal without requiring membership", async () => {
    const before = snapshot(100, "Tablet");
    const after = snapshot(101, "Tablet");
    after.entity.claims = { P2: [] };
    const getEditableTabletEntity = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const mutationClient: MetadataMutationClient = {
      inspect: vi.fn().mockResolvedValue({ csrfToken: "token", requestStartedAt: "2026-09-29T08:00:00Z", expectedUsername: "Editor", expectedUserId: "17" }),
      submit: vi.fn().mockResolvedValue(101),
      confirmAttribution: vi.fn().mockResolvedValue(undefined),
    };

    await expect(saveMetadata({
      qid: "Q42",
      accessToken: "access",
      identity: { providerUserId: "17", username: "Editor" },
      request: {
        baseRevision: 100,
        summary: "Remove classification",
        confirmRemovals: true,
        confirmCatalogueRemoval: true,
        operations: [{ type: "remove-statement", statementId: "Q42$member" }],
      },
    }, { factGrid: { getEditableTabletEntity }, mutationClient })).resolves.toMatchObject({ revisionId: 101 });
    expect(getEditableTabletEntity).toHaveBeenLastCalledWith("Q42", [], false);
  });

  it("requires confirmation when an equal-count qualifier replacement removes a hash", async () => {
    const before = snapshot(100, "Tablet");
    const membership = before.entity.claims?.P2?.[0];
    if (!membership) throw new Error("missing fixture statement");
    membership.qualifiers = {
      P10: [{ property: "P10", datatype: "string", snaktype: "value", hash: "a".repeat(40), datavalue: { type: "string", value: "old" } }],
    };
    membership["qualifiers-order"] = ["P10"];
    before.properties.P10 = { id: "P10", datatype: "string", labels: {}, descriptions: {} };
    before.properties.P11 = { id: "P11", datatype: "string", labels: {}, descriptions: {} };
    const mutationClient: MetadataMutationClient = { inspect: vi.fn(), submit: vi.fn(), confirmAttribution: vi.fn() };

    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: {
        baseRevision: 100, summary: "Replace qualifier", confirmRemovals: false, confirmCatalogueRemoval: false,
        operations: [{ type: "upsert-statement", statement: {
          id: "Q42$member", rank: "normal",
          mainsnak: { property: "P2", datatype: "wikibase-item", snaktype: "value", value: { kind: "entity", id: "Q512006", entityType: "item" } },
          qualifiers: { P11: [{ property: "P11", datatype: "string", snaktype: "value", value: { kind: "string", value: "new" } }] },
          qualifierOrder: ["P11"], references: [],
        } }],
      },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient })).rejects.toMatchObject({ code: "invalid_request" });
    expect(mutationClient.inspect).not.toHaveBeenCalled();
  });

  it("keeps P251 read only in the generic metadata service", async () => {
    const before = snapshot(100, "Tablet");
    before.properties.P251 = { id: "P251", datatype: "url", labels: {}, descriptions: {} };
    const mutationClient: MetadataMutationClient = { inspect: vi.fn(), submit: vi.fn(), confirmAttribution: vi.fn() };
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: {
        baseRevision: 100, summary: "Unsafe link", confirmRemovals: false, confirmCatalogueRemoval: false,
        operations: [{ type: "upsert-statement", statement: {
          rank: "normal", mainsnak: { property: "P251", datatype: "url", snaktype: "value", value: { kind: "string", value: "https://database.factgrid.de/wiki/Other-Q42" } },
          qualifiers: {}, qualifierOrder: [], references: [],
        } }],
      },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient })).rejects.toMatchObject({ code: "invalid_request" });
    expect(mutationClient.inspect).not.toHaveBeenCalled();
  });
});
