import { describe, expect, it } from "vitest";

import {
  buildMetadataOperations,
  type EditableEntity,
  type EditableStatement,
} from "./metadata-editor";

function idlessStatement(value: string): EditableStatement {
  return {
    rank: "normal",
    mainsnak: {
      property: "P11",
      datatype: "string",
      snaktype: "value",
      value: { kind: "string", value },
    },
    qualifiers: {},
    qualifierOrder: [],
    references: [],
  };
}

function entity(statement: EditableStatement): EditableEntity {
  return {
    id: "Q42",
    lastRevision: 12,
    labels: { en: "Tablet" },
    descriptions: {},
    aliases: {},
    sitelinks: {},
    statements: [statement],
  };
}

describe("buildMetadataOperations ID-less baselines", () => {
  it("does not turn an unchanged ID-less baseline statement into an addition", () => {
    const baseline = entity(idlessStatement("legacy"));
    const draft = structuredClone(baseline);
    draft.labels.en = "Renamed tablet";

    expect(buildMetadataOperations(baseline, draft)).toEqual([
      { type: "set-label", language: "en", value: "Renamed tablet" },
    ]);
  });

  it("still emits a genuinely new ID-less statement", () => {
    const baseline = entity(idlessStatement("legacy"));
    const draft = structuredClone(baseline);
    draft.statements.push(idlessStatement("new value"));

    expect(buildMetadataOperations(baseline, draft)).toEqual([
      { type: "upsert-statement", statement: idlessStatement("new value") },
    ]);
  });
});
