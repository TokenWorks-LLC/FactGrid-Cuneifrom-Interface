import {
  CUNEIFORM_CATALOGUE_QID,
  FACTGRID,
  FACTGRID_LIMITS,
  FACTGRID_PROPERTIES,
} from "./constants";
import { editionLabel, resolveFactGridDocumentUrl } from "./documents";
import { FactGridError } from "./errors";
import type {
  DimensionValue,
  DocumentRevision,
  LabeledEntity,
  MediaWikiPage,
  Qid,
  SourceLink,
  TabletEdition,
  TabletRecord,
  WikibaseEntity,
  WikibaseStatement,
  WikibaseTerm,
} from "./types";
import { parseWikitextSections, analyzeTranscriptSource } from "./transcript";
import { parseQid } from "./validation";

export type LabelMap = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

function mapLabel(labels: LabelMap, id: string): string | undefined {
  if (labels instanceof Map) return labels.get(id);
  return (labels as Readonly<Record<string, string>>)[id];
}

function bestTerm(terms: Record<string, WikibaseTerm> | undefined): string | undefined {
  const preferred = terms?.en?.value ?? terms?.de?.value;
  if (preferred) return preferred;
  return Object.entries(terms ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, term]) => term.value)
    .find((value): value is string => typeof value === "string" && value.length > 0);
}

function activeStatements(entity: WikibaseEntity, property: string): WikibaseStatement[] {
  const statements = entity.claims?.[property];
  return Array.isArray(statements)
    ? statements.filter((statement) => statement.rank !== "deprecated")
    : [];
}

function statementValues(entity: WikibaseEntity, property: string): unknown[] {
  return activeStatements(entity, property)
    .filter((statement) => statement.mainsnak?.snaktype === "value")
    .map((statement) => statement.mainsnak?.datavalue?.value)
    .filter((value) => value !== undefined);
}

function stringValues(entity: WikibaseEntity, property: string): string[] {
  return statementValues(entity, property).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function statementStringValue(statement: WikibaseStatement): string | undefined {
  const value = statement.mainsnak?.datavalue?.value;
  return statement.mainsnak?.snaktype === "value" && typeof value === "string" && value.trim()
    ? value
    : undefined;
}

function safeStatementId(value: string | undefined, qid: Qid): string | undefined {
  if (!value || value.length > 120) return undefined;
  return new RegExp(`^${qid}\\$[A-Za-z0-9-]+$`).test(value) ? value : undefined;
}

function qidFromUnknown(value: unknown): Qid | undefined {
  if (!value || typeof value !== "object" || !("id" in value)) return undefined;
  const id = (value as { id?: unknown }).id;
  try {
    return parseQid(id, "Claim QID");
  } catch {
    return undefined;
  }
}

function entityQids(entity: WikibaseEntity, property: string): Qid[] {
  const seen = new Set<Qid>();
  for (const value of statementValues(entity, property)) {
    const qid = qidFromUnknown(value);
    if (qid) seen.add(qid);
  }
  return [...seen];
}

function labeledEntity(id: Qid, labels: LabelMap): LabeledEntity {
  return {
    id,
    label: mapLabel(labels, id) ?? id,
    url: `${FACTGRID.wikiBase}Item:${id}`,
  };
}

function safePublicUrl(value: string): string | undefined {
  if (value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function sourceLinks(entity: WikibaseEntity): {
  images: SourceLink[];
  externalTranscripts: SourceLink[];
} {
  const images: SourceLink[] = [];
  const externalTranscripts: SourceLink[] = [];

  for (const rawUrl of stringValues(entity, FACTGRID_PROPERTIES.onlineImage)) {
    const url = safePublicUrl(rawUrl);
    if (url) images.push({ kind: "online-image", label: "Online image", url });
  }

  for (const filename of stringValues(entity, FACTGRID_PROPERTIES.commonsImage)) {
    if (filename.length <= 240 && !/[\u0000-\u001f|#]/.test(filename)) {
      images.push({
        kind: "commons-image",
        label: `Wikimedia Commons: ${filename}`,
        url: `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(filename)}`,
      });
    }
  }

  // P69 is always a link. It is never fetched, imported, or treated as editable.
  for (const rawUrl of stringValues(entity, FACTGRID_PROPERTIES.onlineTranscript)) {
    const url = safePublicUrl(rawUrl);
    if (url) {
      externalTranscripts.push({
        kind: "external-transcript",
        label: new URL(url).hostname,
        url,
      });
    }
  }

  return {
    images: dedupeLinks(images),
    externalTranscripts: dedupeLinks(externalTranscripts),
  };
}

function dedupeLinks(links: SourceLink[]): SourceLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function dimensions(entity: WikibaseEntity, labels: LabelMap): DimensionValue[] {
  const entries = Object.entries(FACTGRID_PROPERTIES.dimensions) as Array<
    [DimensionValue["kind"], DimensionValue["property"]]
  >;
  const result: DimensionValue[] = [];

  for (const [kind, property] of entries) {
    for (const value of statementValues(entity, property)) {
      if (!value || typeof value !== "object") continue;
      const quantity = value as { amount?: unknown; unit?: unknown };
      if (typeof quantity.amount !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(quantity.amount)) {
        continue;
      }
      let unit: LabeledEntity | undefined;
      if (typeof quantity.unit === "string" && quantity.unit.startsWith(FACTGRID.entityBase)) {
        try {
          unit = labeledEntity(parseQid(quantity.unit.slice(FACTGRID.entityBase.length), "Unit QID"), labels);
        } catch {
          // Unknown units stay absent rather than becoming unsafe links.
        }
      }
      result.push({ kind, property, amount: quantity.amount.replace(/^\+/, ""), unit });
    }
  }
  return result;
}

export function entityIsCuneiformTablet(entity: WikibaseEntity): boolean {
  return entityQids(entity, FACTGRID_PROPERTIES.membership).includes(CUNEIFORM_CATALOGUE_QID);
}

export function collectReferencedQids(entity: WikibaseEntity): Qid[] {
  const properties = [
    FACTGRID_PROPERTIES.presentHolding,
    FACTGRID_PROPERTIES.findspot,
    FACTGRID_PROPERTIES.period,
    FACTGRID_PROPERTIES.language,
    FACTGRID_PROPERTIES.workType,
    FACTGRID_PROPERTIES.material,
  ];
  const result = new Set<Qid>();
  for (const property of properties) {
    for (const qid of entityQids(entity, property)) result.add(qid);
  }
  for (const property of Object.values(FACTGRID_PROPERTIES.dimensions)) {
    for (const value of statementValues(entity, property)) {
      if (!value || typeof value !== "object") continue;
      const unit = (value as { unit?: unknown }).unit;
      if (typeof unit !== "string" || !unit.startsWith(FACTGRID.entityBase)) continue;
      try {
        result.add(parseQid(unit.slice(FACTGRID.entityBase.length), "Unit QID"));
      } catch {
        // A malformed optional unit must not broaden the label request.
      }
    }
  }
  return [...result];
}

export function adaptTabletEntity(entity: WikibaseEntity, labels: LabelMap = {}): TabletRecord {
  const qid = parseQid(entity.id, "Entity QID");
  if (entity.missing) {
    throw new FactGridError("NOT_FOUND", `No FactGrid item was found for ${qid}.`, {
      status: 404,
    });
  }

  const rawTitle = stringValues(entity, FACTGRID_PROPERTIES.title)[0];
  const title = rawTitle ?? bestTerm(entity.labels) ?? qid;
  const description = bestTerm(entity.descriptions);
  const sources = sourceLinks(entity);
  const documentStatements = activeStatements(entity, FACTGRID_PROPERTIES.documentPage).filter(
    (statement) => statementStringValue(statement) !== undefined,
  );
  const selectedDocuments = documentStatements.slice(0, FACTGRID_LIMITS.maxDocumentPages);
  const editions: TabletEdition[] = selectedDocuments.map((statement) => {
    const value = statementStringValue(statement) as string;
    const editionId = safeStatementId(statement.id, qid);
    const reference = resolveFactGridDocumentUrl(value, qid);
    if ("status" in reference) {
      return {
        editionId,
        kind: "invalid",
        label: "Unavailable document link",
        status: "invalid",
        reason: reference.reason,
      };
    }
    return {
      editionId,
      kind: reference.kind,
      label: editionLabel(reference.kind),
      status: "linked",
      reference,
    };
  });

  const toLabels = (property: string) =>
    entityQids(entity, property).map((id) => labeledEntity(id, labels));

  return {
    qid,
    title,
    description,
    factGridUrl: `${FACTGRID.wikiBase}Item:${qid}`,
    revisionId: entity.lastrevid,
    modified: entity.modified,
    cdliIds: [...new Set(stringValues(entity, FACTGRID_PROPERTIES.cdliId))],
    holdings: toLabels(FACTGRID_PROPERTIES.presentHolding),
    findspots: toLabels(FACTGRID_PROPERTIES.findspot),
    periods: toLabels(FACTGRID_PROPERTIES.period),
    languages: toLabels(FACTGRID_PROPERTIES.language),
    workTypes: toLabels(FACTGRID_PROPERTIES.workType),
    materials: toLabels(FACTGRID_PROPERTIES.material),
    dimensions: dimensions(entity, labels),
    images: sources.images,
    externalTranscripts: sources.externalTranscripts,
    editions,
    omittedEditionCount: Math.max(0, documentStatements.length - selectedDocuments.length),
  };
}

export function adaptDocumentRevision(
  edition: TabletEdition,
  page: MediaWikiPage | undefined,
): TabletEdition {
  if (!edition.reference) return edition;
  if (!page || page.missing || page.invalid) {
    return { ...edition, status: "missing", reason: "FactGrid reports that this page is missing." };
  }

  const rawRevision = page.revisions?.[0];
  const slot = rawRevision?.slots?.main;
  if (
    !rawRevision ||
    typeof rawRevision.revid !== "number" ||
    typeof rawRevision.parentid !== "number" ||
    typeof rawRevision.timestamp !== "string" ||
    typeof slot?.content !== "string" ||
    typeof slot.contentmodel !== "string" ||
    typeof slot.contentformat !== "string"
  ) {
    return { ...edition, status: "unsupported", reason: "The page has no readable current revision." };
  }

  const revision: DocumentRevision = {
    revisionId: rawRevision.revid,
    parentRevisionId: rawRevision.parentid,
    timestamp: rawRevision.timestamp,
    contentModel: slot.contentmodel,
    contentFormat: slot.contentformat,
    source: slot.content,
    sections: parseWikitextSections(slot.content),
    transcript:
      slot.contentmodel === "wikitext"
        ? analyzeTranscriptSource(edition.reference, slot.content)
        : null,
  };

  if (revision.transcript?.editable && !edition.editionId) {
    revision.transcript = {
      ...revision.transcript,
      editable: false,
      reason: "This edition has no stable P251 statement identifier and is read-only.",
    };
  }

  if (slot.contentmodel !== "wikitext") {
    return {
      ...edition,
      status: "unsupported",
      revision,
      reason: `The ${slot.contentmodel} content model is read-only.`,
    };
  }

  return { ...edition, status: "loaded", revision };
}
