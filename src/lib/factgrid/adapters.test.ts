import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { adaptTabletEntity } from "./adapters";
import { resolveFactGridDocumentUrl } from "./documents";
import {
  analyzeTranscriptSource,
  spliceTranscriptSource,
  validatePlainTranscriptReplacement,
} from "./transcript";
import type { DocumentReference, WbGetEntitiesResponse } from "./types";

const fixtureRoot = `${process.cwd()}/tests/fixtures/factgrid`;
const reference: DocumentReference = {
  kind: "d",
  qid: "Q9000002",
  title: "D-Q9000002",
  url: "https://database.factgrid.de/wiki/D-Q9000002",
};

function entityFixture(name: string) {
  return JSON.parse(readFileSync(`${fixtureRoot}/${name}`, "utf8")).response as WbGetEntitiesResponse;
}

describe("FactGrid entity adapters", () => {
  it("adapts a sparse tablet without inventing transcript data", () => {
    const response = entityFixture("entity-sparse-no-transcript.json");
    const record = adaptTabletEntity(response.entities!.Q9000001);

    expect(record.title).toContain("sparse tablet");
    expect(record.editions).toEqual([]);
    expect(record.externalTranscripts).toEqual([]);
    expect(record.images).toEqual([]);
  });

  it("classifies editions, preserves P251 IDs, and only links P69", () => {
    const response = entityFixture("entity-multiple-editions.json");
    const record = adaptTabletEntity(response.entities!.Q9000002, {
      Q9000100: "Fixture collection",
      Q9000101: "Fixture findspot",
      Q9000102: "Fixture period",
      Q102135: "centimetre",
    });

    expect(record.editions.slice(0, 4).map((edition) => edition.kind)).toEqual([
      "d",
      "cdli",
      "oracc",
      "unicode",
    ]);
    expect(record.editions[0].editionId).toBe("Q9000002$d-fixture-guid");
    expect(record.editions.at(-2)).toMatchObject({ kind: "invalid", status: "invalid" });
    expect(record.editions.at(-1)).toMatchObject({ kind: "other", editionId: undefined });
    expect(record.externalTranscripts).toEqual([
      expect.objectContaining({
        kind: "external-transcript",
        url: "https://example.invalid/transcript/PTEST002",
      }),
    ]);
    expect(record.dimensions[0]).toMatchObject({ amount: "8.5", unit: { label: "centimetre" } });
  });
});

describe("FactGrid document trust boundary", () => {
  it("accepts only an exact FactGrid page associated with the tablet", () => {
    expect(resolveFactGridDocumentUrl(reference.url, reference.qid)).toMatchObject({
      kind: "d",
      title: reference.title,
    });
    expect(
      resolveFactGridDocumentUrl("https://database.factgrid.de/wiki/D-Q9000999", reference.qid),
    ).toEqual({ status: "invalid", reason: "wrong-record" });
    expect(
      resolveFactGridDocumentUrl("https://attacker.invalid/wiki/D-Q9000002", reference.qid),
    ).toEqual({ status: "invalid", reason: "untrusted-url" });
    expect(
      resolveFactGridDocumentUrl(
        "https://database.factgrid.de/wiki/D-Q9000002?redirect=evil",
        reference.qid,
      ),
    ).toEqual({ status: "invalid", reason: "untrusted-url" });
  });
});

describe("lossless transcript boundaries", () => {
  it("splices a strict plain D-page without changing outside bytes", () => {
    const source = readFileSync(`${fixtureRoot}/plain-d-page.wiki`, "utf8");
    const region = analyzeTranscriptSource(reference, source)!;
    const replacement = "\n1) a-na LUGAL\n2) ša₂ <lost text>\n";
    const result = spliceTranscriptSource(source, region, replacement);

    expect(region).toMatchObject({ format: "plain-poem-v1", editable: true });
    expect(result.slice(0, region.start)).toBe(source.slice(0, region.start));
    expect(result.slice(region.start + replacement.length)).toBe(source.slice(region.end));
  });

  it("keeps mixed wikitext and token-column/CoNLL content read-only", () => {
    const mixed = readFileSync(`${fixtureRoot}/mixed-d-page.wiki`, "utf8");
    const tokenColumns = `<poem property="http://www.purl.org/cuneiform/hasTransliteration">
P123:obverse.1.1\ta-na
</poem>`;
    const conll = `<poem property="http://www.purl.org/cuneiform/hasTransliteration">
1\ta-na\tana\tADP\t_\t_\t0\troot\t_\t_
</poem>`;

    expect(analyzeTranscriptSource(reference, mixed)).toMatchObject({
      format: "mixed-wikitext",
      editable: false,
    });
    expect(analyzeTranscriptSource(reference, tokenColumns)).toMatchObject({
      format: "structured-lines",
      editable: false,
    });
    expect(analyzeTranscriptSource(reference, conll)).toMatchObject({
      format: "structured-lines",
      editable: false,
    });
  });

  it("keeps unverified edition families read-only even when their poem is plain", () => {
    const plain = readFileSync(`${fixtureRoot}/plain-d-page.wiki`, "utf8");
    const cdliReference = {
      ...reference,
      kind: "cdli" as const,
      title: "CDLI-W-Q9000002",
      url: "https://database.factgrid.de/wiki/CDLI-W-Q9000002",
    };

    expect(analyzeTranscriptSource(cdliReference, plain)).toMatchObject({
      format: "plain-poem-v1",
      editable: false,
    });
  });

  it("rejects forged poem boundaries in replacement text", () => {
    expect(() => validatePlainTranscriptReplacement("line\n</poem>\nattack")).toThrow(
      /forbidden poem boundary/i,
    );
  });
});
