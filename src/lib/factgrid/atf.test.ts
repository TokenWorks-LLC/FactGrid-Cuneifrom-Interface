import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { adaptDocumentRevision, adaptTabletEntity } from "./adapters";
import { editionLabel, resolveFactGridDocumentUrl } from "./documents";
import { analyzeTranscriptSource, spliceTranscriptSource } from "./transcript";
import type { DocumentReference, MediaWikiQueryResponse, WbGetEntitiesResponse } from "./types";

const reference: DocumentReference = {
  kind: "atf",
  qid: "Q894483",
  title: "CDLI-ATF-L-Q894483",
  url: "https://database.factgrid.de/wiki/CDLI-ATF-L-Q894483",
};
const atf = "\n&P020415 = TMH 5, 001 \n#version: 0.6 \n#atf: lang sux \n@tablet \n@obverse \n1. ur-{d}inanna [x x] <lost>\n@reverse\n1'. lu2!#\n";
const source = `{{Template:CuneiformInfoBox|894483}}\n<poem>${atf}</poem>\n{{Template:CuneiformImageFC|894483}}`;

describe("read-only CDLI ATF-L editions", () => {
  it("recognizes only the exact family and record in a trusted URL", () => {
    expect(resolveFactGridDocumentUrl(reference.url, reference.qid)).toEqual(reference);
    expect(editionLabel("atf")).toBe("CDLI ATF transliteration");
    expect(resolveFactGridDocumentUrl(reference.url, "Q894307")).toMatchObject({ status: "invalid", reason: "wrong-record" });
    expect(resolveFactGridDocumentUrl(reference.url.replace("database.factgrid.de", "example.test"), reference.qid)).toMatchObject({ status: "invalid" });
    expect(resolveFactGridDocumentUrl(`${reference.url}?action=raw`, reference.qid)).toMatchObject({ status: "invalid" });
    expect(resolveFactGridDocumentUrl(reference.url.replace("ATF-L", "ATF-X"), reference.qid)).toMatchObject({ kind: "other" });
  });

  it("preserves every ATF character and byte range, with editing disabled", () => {
    const region = analyzeTranscriptSource(reference, source)!;
    expect(region).toMatchObject({ format: "atf-v1", content: atf, displayText: atf, editable: false });
    expect(source.slice(region.start, region.end)).toBe(atf);
    expect(() => spliceTranscriptSource(source, region, "replacement")).toThrow(/read-only/iu);
  });

  it("preserves CRLFs, indentation, trailing spaces, brackets and markup-like notation", () => {
    const content = atf.replaceAll("\n", "\r\n").replace("1. ur-", "1.  ur-");
    expect(analyzeTranscriptSource(reference, `<poem>${content}</poem>`)?.displayText).toBe(content);
  });

  it("does not allow an ATF page to fall through to an editable named-section poem", () => {
    expect(analyzeTranscriptSource(reference, `== Transcript ==\n<poem>plain</poem>`)).toBeNull();
    const marked = `<poem property="http://www.purl.org/cuneiform/hasTransliteration">${atf}</poem>`;
    expect(analyzeTranscriptSource(reference, marked)).toMatchObject({ format: "atf-v1", editable: false });
    expect(analyzeTranscriptSource({ ...reference, title: "D-Q894483" }, marked)).toBeNull();
  });

  it.each([
    `<poem>${atf}</poem><poem>${atf}</poem>`,
    `<poem>${atf}`,
    `</poem><poem>${atf}`,
    `<poem>${atf}<poem>nested</poem></poem>`,
    `<poem>${atf}</poem></poem>`,
    `<!-- <poem>${atf}</poem> -->`,
    `<nowiki><poem>${atf}</poem></nowiki>`,
    `<ref><poem>${atf}</poem></ref>`,
    `{{Template|<poem>${atf}</poem>}}`,
    `<poem>${atf.replace("#atf:", "#unknown:")}</poem>`,
    `<poem>${atf.replace("@tablet", "@unknown")}</poem>`,
    `<poem>${atf.replace("&P020415", "unknown")}</poem>`,
  ])("leaves ambiguous, hidden or unrecognized ATF source unsupported", (value) => {
    expect(analyzeTranscriptSource(reference, value)).toBeNull();
  });

  it("reads the captured linked HS 751 edition and retains source revision attribution", () => {
    const fixtureRoot = `${process.cwd()}/tests/fixtures/factgrid`;
    const entities = JSON.parse(readFileSync(`${fixtureRoot}/live-q894483-entity.json`, "utf8")) as WbGetEntitiesResponse;
    const pages = JSON.parse(readFileSync(`${fixtureRoot}/live-q894483-document.json`, "utf8")) as MediaWikiQueryResponse;
    const tablet = adaptTabletEntity(entities.entities!.Q894483);
    expect(tablet.editions).toHaveLength(1);
    expect(tablet.editions[0]).toMatchObject({ reference, editionId: "Q894483$0ACD95A8-BDFF-4584-BE3C-7104AB8745D0" });
    const edition = adaptDocumentRevision(tablet.editions[0], pages.query!.pages![0]);
    expect(edition).toMatchObject({ status: "loaded", kind: "atf", revision: {
      revisionId: 20109826, timestamp: "2026-06-15T16:48:55Z", contentModel: "wikitext",
      transcript: { format: "atf-v1", editable: false },
    } });
    expect(edition.revision!.transcript!.displayText).toContain("@column 2 \n1. dumu AN-lu2-mah");
    expect(edition.revision!.transcript!.displayText).toContain("ur-{d}{sze3}szer7-da");
    expect(edition.revision!.source).toBe(pages.query!.pages![0].revisions![0].slots!.main!.content);
  });
});
