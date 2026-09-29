import { describe, expect, it } from "vitest";

import { parseMetadataWriteRequest } from "./metadata-request";

function request(body: unknown): Request {
  return new Request("https://app.example/api/tablets/Q42/metadata", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("metadata write request", () => {
  it("accepts strict multilingual and datatype-aware operations", async () => {
    const parsed = await parseMetadataWriteRequest(request({
      baseRevision: 100,
      summary: "Correct metadata",
      confirmRemovals: false,
      confirmCatalogueRemoval: false,
      operations: [
        { type: "set-label", language: "akk", value: "𒀭 draft" },
        {
          type: "upsert-statement",
          statement: {
            rank: "normal",
            mainsnak: {
              property: "P59",
              datatype: "quantity",
              snaktype: "value",
              value: { kind: "quantity", amount: "+12.5", unit: "1" },
            },
            qualifiers: {
              P1155: [{
                property: "P1155",
                datatype: "monolingualtext",
                snaktype: "value",
                value: { kind: "monolingualtext", text: "ša", language: "akk" },
              }],
            },
            qualifierOrder: ["P1155"],
            references: [],
          },
        },
      ],
    }));

    expect(parsed.operations).toHaveLength(2);
    expect(parsed.operations[1]).toMatchObject({ type: "upsert-statement" });
  });

  it("rejects unconfirmed removals, arbitrary fields, and unsupported datatypes", async () => {
    await expect(parseMetadataWriteRequest(request({
      baseRevision: 100,
      summary: "",
      confirmRemovals: false,
      confirmCatalogueRemoval: false,
      operations: [{ type: "remove-statement", statementId: "Q42$abc" }],
    }))).rejects.toMatchObject({ code: "invalid_request" });

    await expect(parseMetadataWriteRequest(request({
      baseRevision: 100,
      summary: "",
      confirmRemovals: true,
      confirmCatalogueRemoval: false,
      operations: [{ type: "set-label", language: "en", value: "x", action: "delete" }],
    }))).rejects.toMatchObject({ code: "invalid_request" });

    await expect(parseMetadataWriteRequest(request({
      baseRevision: 100,
      summary: "",
      confirmRemovals: false,
      confirmCatalogueRemoval: false,
      operations: [{
        type: "upsert-statement",
        statement: {
          rank: "normal",
          mainsnak: { property: "P1", datatype: "musical-notation", snaktype: "novalue" },
          qualifiers: {},
          qualifierOrder: [],
          references: [],
        },
      }],
    }))).rejects.toMatchObject({ code: "invalid_request" });
  });
});
