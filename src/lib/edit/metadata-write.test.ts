import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EditableTabletEntity } from "@/lib/factgrid/types";

import type { MetadataStatement } from "./metadata-request";
import {
  createMetadataMutationClient,
  saveMetadata,
  type MetadataInspection,
  type MetadataMutationClient,
} from "./metadata-write";

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

function stringStatement(value: string, id?: string): MetadataStatement {
  return {
    ...(id ? { id } : {}),
    rank: "normal",
    mainsnak: {
      property: "P10",
      datatype: "string",
      snaktype: "value",
      value: { kind: "string", value },
    },
    qualifiers: {},
    qualifierOrder: [],
    references: [],
  };
}

function mutationSpies(): MetadataMutationClient {
  return {
    inspect: vi.fn(),
    submit: vi.fn(),
    confirmAttribution: vi.fn(),
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

  it("rejects duplicate new statements and statements already present before provider access", async () => {
    const before = snapshot(100, "Tablet");
    before.properties.P10 = { id: "P10", datatype: "string", labels: {}, descriptions: {} };
    before.entity.claims!.P10 = [{
      id: "Q42$existing",
      type: "statement",
      rank: "normal",
      mainsnak: {
        property: "P10",
        datatype: "string",
        snaktype: "value",
        datavalue: { type: "string", value: "existing" },
      },
    }];

    for (const operations of [
      [
        { type: "upsert-statement" as const, statement: stringStatement("duplicate") },
        { type: "upsert-statement" as const, statement: stringStatement("duplicate") },
      ],
      [{ type: "upsert-statement" as const, statement: stringStatement("existing") }],
    ]) {
      const mutationClient = mutationSpies();
      await expect(saveMetadata({
        qid: "Q42",
        accessToken: "access",
        identity: { providerUserId: "17", username: "Editor" },
        request: {
          baseRevision: 100,
          summary: "Add statement",
          confirmRemovals: false,
          confirmCatalogueRemoval: false,
          operations,
        },
      }, {
        factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) },
        mutationClient,
      })).rejects.toMatchObject({ code: "invalid_request" });
      expect(mutationClient.inspect).not.toHaveBeenCalled();
      expect(mutationClient.submit).not.toHaveBeenCalled();
    }
  });

  it("rejects nested P251 additions and removals through the generic metadata workflow", async () => {
    const before = snapshot(100, "Tablet");
    before.properties.P10 = { id: "P10", datatype: "string", labels: {}, descriptions: {} };
    before.properties.P251 = { id: "P251", datatype: "url", labels: {}, descriptions: {} };
    const unsafe = {
      property: "P251",
      datatype: "url" as const,
      snaktype: "value" as const,
      value: { kind: "string" as const, value: "https://database.factgrid.de/wiki/D-Q42" },
    };

    for (const statement of [
      { ...stringStatement("qualified"), qualifiers: { P251: [unsafe] }, qualifierOrder: ["P251"] },
      { ...stringStatement("referenced"), references: [{ snaks: { P251: [unsafe] }, snaksOrder: ["P251"] }] },
    ]) {
      const mutationClient = mutationSpies();
      await expect(saveMetadata({
        qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
        request: { baseRevision: 100, summary: "Unsafe nested link", confirmRemovals: false, confirmCatalogueRemoval: false, operations: [{ type: "upsert-statement", statement }] },
      }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient })).rejects.toMatchObject({ code: "invalid_request" });
      expect(mutationClient.inspect).not.toHaveBeenCalled();
    }

    const current = before.entity.claims!.P2![0];
    current.qualifiers = {
      P251: [{ property: "P251", datatype: "url", snaktype: "value", hash: "a".repeat(40), datavalue: { type: "string", value: "https://database.factgrid.de/wiki/D-Q42" } }],
    };
    current["qualifiers-order"] = ["P251"];
    const mutationClient = mutationSpies();
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: { baseRevision: 100, summary: "Remove protected statement", confirmRemovals: true, confirmCatalogueRemoval: true, operations: [{ type: "remove-statement", statementId: "Q42$member" }] },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient })).rejects.toMatchObject({ code: "invalid_request" });
    expect(mutationClient.inspect).not.toHaveBeenCalled();

    const stripClient = mutationSpies();
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: {
        baseRevision: 100,
        summary: "Strip protected qualifier",
        confirmRemovals: true,
        confirmCatalogueRemoval: false,
        operations: [{
          type: "upsert-statement",
          statement: {
            id: "Q42$member",
            rank: "normal",
            mainsnak: { property: "P2", datatype: "wikibase-item", snaktype: "value", value: { kind: "entity", id: "Q512006", entityType: "item" } },
            qualifiers: {},
            qualifierOrder: [],
            references: [],
          },
        }],
      },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient: stripClient })).rejects.toMatchObject({ code: "invalid_request" });
    expect(stripClient.inspect).not.toHaveBeenCalled();
  });

  it("binds hashes to their structural property and owning reference", async () => {
    const before = snapshot(100, "Tablet");
    const current = before.entity.claims!.P2![0];
    before.properties.P10 = { id: "P10", datatype: "string", labels: {}, descriptions: {} };
    before.properties.P11 = { id: "P11", datatype: "string", labels: {}, descriptions: {} };
    const qualifierHash = "a".repeat(40);
    const referenceHash = "b".repeat(40);
    const referenceSnakHash = "c".repeat(40);
    current.qualifiers = {
      P10: [{ property: "P10", datatype: "string", snaktype: "value", hash: qualifierHash, datavalue: { type: "string", value: "qualifier" } }],
    };
    current["qualifiers-order"] = ["P10"];
    current.references = [{
      hash: referenceHash,
      snaks: { P11: [{ property: "P11", datatype: "string", snaktype: "value", hash: referenceSnakHash, datavalue: { type: "string", value: "source" } }] },
      "snaks-order": ["P11"],
    }];
    const forged: MetadataStatement = {
      id: "Q42$member",
      rank: "normal",
      mainsnak: { property: "P2", datatype: "wikibase-item", snaktype: "value", value: { kind: "entity", id: "Q512006", entityType: "item" } },
      qualifiers: {
        P11: [{ property: "P11", datatype: "string", snaktype: "value", hash: qualifierHash, value: { kind: "string", value: "qualifier" } }],
      },
      qualifierOrder: ["P11"],
      references: [{ hash: referenceHash, snaks: { P10: [{ property: "P10", datatype: "string", snaktype: "value", hash: referenceSnakHash, value: { kind: "string", value: "source" } }] }, snaksOrder: ["P10"] }],
    };
    const mutationClient = mutationSpies();
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: { baseRevision: 100, summary: "Forge hashes", confirmRemovals: true, confirmCatalogueRemoval: false, operations: [{ type: "upsert-statement", statement: forged }] },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient })).rejects.toMatchObject({ code: "invalid_request" });
    expect(mutationClient.inspect).not.toHaveBeenCalled();

    const forgedReference: MetadataStatement = {
      ...forged,
      qualifiers: {
        P10: [{ property: "P10", datatype: "string", snaktype: "value", hash: qualifierHash, value: { kind: "string", value: "qualifier" } }],
      },
      qualifierOrder: ["P10"],
      references: [{ hash: referenceHash, snaks: { P10: [{ property: "P10", datatype: "string", snaktype: "value", hash: referenceSnakHash, value: { kind: "string", value: "source" } }] }, snaksOrder: ["P10"] }],
    };
    const referenceClient = mutationSpies();
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: { baseRevision: 100, summary: "Move reference hash", confirmRemovals: true, confirmCatalogueRemoval: false, operations: [{ type: "upsert-statement", statement: forgedReference }] },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient: referenceClient })).rejects.toMatchObject({ code: "invalid_request" });
    expect(referenceClient.inspect).not.toHaveBeenCalled();

    const duplicateReferenceClient = mutationSpies();
    const exactReference = { hash: referenceHash, snaks: { P11: [{ property: "P11", datatype: "string" as const, snaktype: "value" as const, hash: referenceSnakHash, value: { kind: "string" as const, value: "source" } }] }, snaksOrder: ["P11"] };
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: { baseRevision: 100, summary: "Duplicate reference hash", confirmRemovals: true, confirmCatalogueRemoval: false, operations: [{ type: "upsert-statement", statement: { ...forgedReference, references: [exactReference, exactReference] } }] },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient: duplicateReferenceClient })).rejects.toMatchObject({ code: "invalid_request" });
    expect(duplicateReferenceClient.inspect).not.toHaveBeenCalled();

    current.references![0].snaks!.P11![0].hash = qualifierHash;
    const scopedReuse: MetadataStatement = {
      ...forgedReference,
      references: [{ hash: referenceHash, snaks: { P11: [{ property: "P11", datatype: "string", snaktype: "value", hash: qualifierHash, value: { kind: "string", value: "source" } }] }, snaksOrder: ["P11"] }],
    };
    const scopedReuseClient = mutationSpies();
    vi.mocked(scopedReuseClient.inspect).mockRejectedValueOnce(new Error("validation passed"));
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: { baseRevision: 100, summary: "Preserve scoped hashes", confirmRemovals: false, confirmCatalogueRemoval: false, operations: [{ type: "upsert-statement", statement: scopedReuse }] },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValue(before) }, mutationClient: scopedReuseClient })).rejects.toThrow("validation passed");
    expect(scopedReuseClient.inspect).toHaveBeenCalledOnce();
  });

  it("accepts an exact lower-case provider GUID only when it is present on the loaded entity", async () => {
    const before = snapshot(100, "Old");
    const after = snapshot(101, "Old");
    before.properties.P10 = after.properties.P10 = { id: "P10", datatype: "string", labels: {}, descriptions: {} };
    before.entity.claims!.P10 = [{ id: "q42$historical_guid", type: "statement", rank: "normal", mainsnak: { property: "P10", datatype: "string", snaktype: "value", datavalue: { type: "string", value: "old" } } }];
    after.entity.claims!.P10 = [{ id: "q42$historical_guid", type: "statement", rank: "normal", mainsnak: { property: "P10", datatype: "string", snaktype: "value", datavalue: { type: "string", value: "new" } } }];
    const mutationClient: MetadataMutationClient = {
      inspect: vi.fn().mockResolvedValue({ csrfToken: "token-value", requestStartedAt: "2026-09-29T08:00:00Z", expectedUsername: "Editor", expectedUserId: "17" }),
      submit: vi.fn().mockResolvedValue(101),
      confirmAttribution: vi.fn().mockResolvedValue(undefined),
    };
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: { baseRevision: 100, summary: "Update historical statement", confirmRemovals: false, confirmCatalogueRemoval: false, operations: [{ type: "upsert-statement", statement: stringStatement("new", "q42$historical_guid") }] },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after) }, mutationClient })).resolves.toMatchObject({ revisionId: 101 });
  });
});

describe("metadata mutation provider attribution", () => {
  const inspection: MetadataInspection = {
    csrfToken: "provider-token",
    requestStartedAt: "2026-09-29T08:00:00Z",
    expectedUsername: "Editor",
    expectedUserId: "17",
  };

  function revisionResponse(overrides: Record<string, unknown> = {}): Response {
    return Response.json({
      query: {
        pages: [{
          ns: 120,
          title: "Item:Q42",
          revisions: [{ revid: 101, user: "Editor", userid: 17, comment: "/* wbeditentity-update:0| */ Item changed, Rename 𒀭" }],
          ...overrides,
        }],
      },
    });
  }

  it.each([
    "/* wbeditentity-update: */",
    "/* wbeditentity-update:0| */ Item changed, Rename 𒀭",
  ])("accepts provider-generated wbeditentity comment shape: %s", async (comment) => {
    const client = createMetadataMutationClient({
      fetch: vi.fn().mockResolvedValue(revisionResponse({ revisions: [{ revid: 101, user: "Editor", userid: 17, comment }] })),
    });
    await expect(client.confirmAttribution("access", "Q42", 101, "Rename 𒀭", inspection)).resolves.toBeUndefined();
  });

  it.each([
    { title: "Item:Q43" },
    { ns: 0 },
    { revisions: [{ revid: 102, user: "Editor", userid: 17, comment: "/* wbeditentity-update:0| */ Item changed" }] },
    { revisions: [{ revid: 101, user: "Other", userid: 17, comment: "/* wbeditentity-update:0| */ Item changed" }] },
    { revisions: [{ revid: 101, user: "Editor", userid: 18, comment: "/* wbeditentity-update:0| */ Item changed" }] },
    { revisions: [{ revid: 101, user: "Editor", userid: 17, comment: "Rename" }] },
  ])("rejects mismatched attribution %#", async (override) => {
    const client = createMetadataMutationClient({ fetch: vi.fn().mockResolvedValue(revisionResponse(override)) });
    await expect(client.confirmAttribution("access", "Q42", 101, "Rename", inspection)).rejects.toMatchObject({ code: "save_confirmation_failed" });
  });

  it.each(["timeout", "http", "invalid-json"])("keeps accepted-unconfirmed semantics after %s attribution failure", async (failure) => {
    const before = snapshot(100, "Old");
    const after = snapshot(101, "New");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        curtimestamp: "2026-09-29T08:00:00Z",
        query: { userinfo: { id: 17, name: "Editor", rights: ["edit"] }, tokens: { csrftoken: "provider-token" }, pages: [{ ns: 120, title: "Item:Q42", actions: { edit: true } }] },
      }))
      .mockResolvedValueOnce(Response.json({ success: 1, entity: { id: "Q42", lastrevid: 101 } }));
    if (failure === "timeout") fetchMock.mockRejectedValueOnce(new Error("timed out"));
    else if (failure === "http") fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    else fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } }));
    const mutationClient = createMetadataMutationClient({ fetch: fetchMock });
    await expect(saveMetadata({
      qid: "Q42", accessToken: "access", identity: { providerUserId: "17", username: "Editor" },
      request: { baseRevision: 100, summary: "Rename", confirmRemovals: false, confirmCatalogueRemoval: false, operations: [{ type: "set-label", language: "en", value: "New" }] },
    }, { factGrid: { getEditableTabletEntity: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after) }, mutationClient })).rejects.toMatchObject({ code: "save_confirmation_failed", status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
