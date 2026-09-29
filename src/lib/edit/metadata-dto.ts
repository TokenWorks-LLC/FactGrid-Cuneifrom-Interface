import type {
  EditableTabletEntity,
  WikibaseReference,
  WikibaseSnak,
  WikibaseStatement,
  WikibaseTerm,
} from "@/lib/factgrid/types";
import { FACTGRID_PROPERTIES } from "@/lib/factgrid/constants";

import type { MetadataValue } from "./metadata-request";

const SUPPORTED_DATATYPES = new Set([
  "string",
  "external-id",
  "url",
  "commonsMedia",
  "geo-shape",
  "tabular-data",
  "wikibase-item",
  "wikibase-property",
  "wikibase-lexeme",
  "wikibase-form",
  "wikibase-sense",
  "monolingualtext",
  "time",
  "quantity",
  "globe-coordinate",
]);

export interface MetadataSnakDto {
  property: string;
  datatype: string;
  snaktype: "value" | "somevalue" | "novalue";
  hash?: string;
  value?: MetadataValue | { kind: "unsupported"; raw: unknown };
}

export interface MetadataStatementDto {
  id: string | null;
  rank: "preferred" | "normal" | "deprecated";
  mainsnak: MetadataSnakDto;
  qualifiers: Record<string, MetadataSnakDto[]>;
  qualifierOrder: string[];
  references: Array<{
    hash?: string;
    snaks: Record<string, MetadataSnakDto[]>;
    snaksOrder: string[];
  }>;
}

export interface MetadataEditModel {
  entity: {
    id: string;
    lastRevision: number;
    modified?: string;
    labels: Record<string, string>;
    descriptions: Record<string, string>;
    aliases: Record<string, string[]>;
    sitelinks: Record<string, { title: string; badges: string[] }>;
    statements: MetadataStatementDto[];
  };
  properties: Record<
    string,
    {
      id: string;
      datatype: string;
      labels: Record<string, string>;
      descriptions: Record<string, string>;
      label: string;
      description?: string;
      supported: boolean;
      readOnlyReason?: string;
    }
  >;
}

function terms(values: Record<string, WikibaseTerm> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values ?? {}).flatMap(([language, term]) =>
      typeof term.value === "string" ? [[language, term.value]] : [],
    ),
  );
}

function aliases(
  values: Record<string, WikibaseTerm[]> | undefined,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([language, languageTerms]) => [
      language,
      languageTerms.flatMap((term) =>
        typeof term.value === "string" ? [term.value] : [],
      ),
    ]),
  );
}

function stringValue(value: unknown): MetadataValue | { kind: "unsupported"; raw: unknown } {
  if (typeof value === "string") return { kind: "string", value };
  if (!value || typeof value !== "object") return { kind: "unsupported", raw: value };
  const record = value as Record<string, unknown>;
  if (
    typeof record.id === "string" &&
    typeof record["entity-type"] === "string" &&
    ["item", "property", "lexeme", "form", "sense"].includes(record["entity-type"])
  ) {
    return {
      kind: "entity",
      id: record.id,
      entityType: record["entity-type"] as "item" | "property" | "lexeme" | "form" | "sense",
    };
  }
  if (typeof record.text === "string" && typeof record.language === "string") {
    return { kind: "monolingualtext", text: record.text, language: record.language };
  }
  if (
    typeof record.time === "string" &&
    typeof record.timezone === "number" &&
    typeof record.before === "number" &&
    typeof record.after === "number" &&
    typeof record.precision === "number" &&
    typeof record.calendarmodel === "string"
  ) {
    return {
      kind: "time",
      time: record.time,
      timezone: record.timezone,
      before: record.before,
      after: record.after,
      precision: record.precision,
      calendarModel: record.calendarmodel,
    };
  }
  if (
    typeof record.amount === "string" &&
    typeof record.unit === "string"
  ) {
    return {
      kind: "quantity",
      amount: record.amount,
      unit: record.unit,
      ...(typeof record.lowerBound === "string" ? { lowerBound: record.lowerBound } : {}),
      ...(typeof record.upperBound === "string" ? { upperBound: record.upperBound } : {}),
    };
  }
  if (
    typeof record.latitude === "number" &&
    typeof record.longitude === "number" &&
    typeof record.precision === "number" &&
    typeof record.globe === "string"
  ) {
    return {
      kind: "coordinate",
      latitude: record.latitude,
      longitude: record.longitude,
      altitude: typeof record.altitude === "number" ? record.altitude : null,
      precision: record.precision,
      globe: record.globe,
    };
  }
  return { kind: "unsupported", raw: value };
}

function snak(value: WikibaseSnak | undefined): MetadataSnakDto {
  const snaktype = ["value", "somevalue", "novalue"].includes(value?.snaktype ?? "")
    ? (value?.snaktype as MetadataSnakDto["snaktype"])
    : "novalue";
  return {
    property: value?.property ?? "",
    datatype: value?.datatype ?? "",
    snaktype,
    ...(value?.hash ? { hash: value.hash } : {}),
    ...(snaktype === "value" ? { value: stringValue(value?.datavalue?.value) } : {}),
  };
}

function snakMap(values: Record<string, WikibaseSnak[]> | undefined): Record<string, MetadataSnakDto[]> {
  return Object.fromEntries(
    Object.entries(values ?? {}).map(([property, snaks]) => [property, snaks.map(snak)]),
  );
}

function reference(value: WikibaseReference) {
  const snaks = snakMap(value.snaks);
  return {
    ...(value.hash ? { hash: value.hash } : {}),
    snaks,
    snaksOrder: value["snaks-order"] ?? Object.keys(snaks),
  };
}

function statement(value: WikibaseStatement): MetadataStatementDto {
  const qualifiers = snakMap(value.qualifiers);
  return {
    id: value.id ?? null,
    rank: value.rank ?? "normal",
    mainsnak: snak(value.mainsnak),
    qualifiers,
    qualifierOrder: value["qualifiers-order"] ?? Object.keys(qualifiers),
    references: (value.references ?? []).map(reference),
  };
}

function bestTerm(values: Record<string, string>): string | undefined {
  return values.en ?? values.de ?? Object.entries(values).sort(([a], [b]) => a.localeCompare(b))[0]?.[1];
}

export function adaptMetadataEditModel(snapshot: EditableTabletEntity): MetadataEditModel {
  const labels = terms(snapshot.entity.labels);
  const descriptions = terms(snapshot.entity.descriptions);
  return {
    entity: {
      id: snapshot.entity.id,
      lastRevision: snapshot.entity.lastrevid,
      ...(snapshot.entity.modified ? { modified: snapshot.entity.modified } : {}),
      labels,
      descriptions,
      aliases: aliases(snapshot.entity.aliases),
      sitelinks: Object.fromEntries(
        Object.entries(snapshot.entity.sitelinks ?? {}).flatMap(([site, value]) =>
          typeof value.title === "string"
            ? [[site, { title: value.title, badges: value.badges ?? [] }]]
            : [],
        ),
      ),
      statements: Object.values(snapshot.entity.claims ?? {}).flatMap((values) =>
        values.map(statement),
      ),
    },
    properties: Object.fromEntries(
      Object.entries(snapshot.properties).map(([id, property]) => {
        const propertyLabels = terms(property.labels);
        const propertyDescriptions = terms(property.descriptions);
        const dedicatedWorkflow = id === FACTGRID_PROPERTIES.documentPage;
        const supported = SUPPORTED_DATATYPES.has(property.datatype) && !dedicatedWorkflow;
        return [
          id,
          {
            id,
            datatype: property.datatype,
            labels: propertyLabels,
            descriptions: propertyDescriptions,
            label: bestTerm(propertyLabels) ?? id,
            ...(bestTerm(propertyDescriptions)
              ? { description: bestTerm(propertyDescriptions) }
              : {}),
            supported,
            ...(!supported
              ? { readOnlyReason: dedicatedWorkflow
                ? "FactGrid document links are managed by the transcription workflow."
                : `The ${property.datatype} datatype is not safely editable here.` }
              : {}),
          },
        ];
      }),
    ),
  };
}
