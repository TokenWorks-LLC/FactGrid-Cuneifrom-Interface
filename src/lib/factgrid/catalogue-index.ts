import { FACTGRID } from "./constants";
import { TABLET_ELIGIBILITY_POLICY, READABLE_TABLET_CLASS_QIDS } from "./eligibility";
import type { LabeledEntity, NormalizedSearchInput, Qid, TabletFacets } from "./types";

export type CatalogueFacet = "collection" | "findspot" | "period" | "language" | "workType" | "material";

/** Discovery metadata only: never a copy of an edition or an editable entity. */
export interface CatalogueEntry {
  id: Qid;
  label: string;
  terms: string;
  collection: Qid[];
  findspot: Qid[];
  period: Qid[];
  language: Qid[];
  workType: Qid[];
  material: Qid[];
}

export interface CatalogueIndex {
  version: 1;
  policy: string;
  classes: Qid[];
  startedAt: string;
  generatedAt: string;
  complete: true;
  sourceCount: number;
  records: CatalogueEntry[];
  labels: Record<string, string>;
  facetAliases?: Record<string, string[]>;
}

const QID = /^Q[1-9][0-9]{0,14}$/u;
const facets = ["collection", "findspot", "period", "language", "workType", "material"] as const;
const searchTexts = new WeakMap<CatalogueIndex, string[]>();
const facetChoices = new WeakMap<CatalogueIndex, Map<CatalogueFacet, LabeledEntity[]>>();

/** Reject truncated, mismatched or malformed refreshes before replacing the last good index. */
export function parseCatalogueIndex(value: unknown): CatalogueIndex {
  if (!value || typeof value !== "object") throw new Error("Invalid catalogue index");
  const index = value as CatalogueIndex;
  if (index.version !== 1 || index.policy !== TABLET_ELIGIBILITY_POLICY || index.complete !== true ||
      !Array.isArray(index.classes) || index.classes.length !== READABLE_TABLET_CLASS_QIDS.length ||
      !READABLE_TABLET_CLASS_QIDS.every((id) => index.classes.includes(id)) ||
      typeof index.startedAt !== "string" || typeof index.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(index.startedAt)) || !Number.isFinite(Date.parse(index.generatedAt)) ||
      Date.parse(index.generatedAt) < Date.parse(index.startedAt) ||
      !Array.isArray(index.records) || index.records.length > 1_000_000 || !Number.isSafeInteger(index.sourceCount) || index.sourceCount < 1 || index.sourceCount !== index.records.length ||
      !index.labels || typeof index.labels !== "object" || Array.isArray(index.labels)) {
    throw new Error("Incomplete or incompatible catalogue index");
  }
  let previous = "";
  for (const entry of index.records) {
    if (!entry || typeof entry.id !== "string" || !QID.test(entry.id) || entry.id <= previous ||
        typeof entry.label !== "string" || entry.label.length > 10_000 ||
        typeof entry.terms !== "string" || entry.terms.length > 50_000 ||
        facets.some((facet) => !Array.isArray(entry[facet]) || entry[facet].length > 1_000 ||
          entry[facet].some((id) => typeof id !== "string" || !QID.test(id)))) {
      throw new Error("Malformed catalogue entry or duplicate ordering key");
    }
    previous = entry.id;
  }
  for (const [id, label] of Object.entries(index.labels)) {
    if (!QID.test(id) || typeof label !== "string" || label.length > 10_000) {
      throw new Error("Malformed catalogue facet label");
    }
  }
  if (index.facetAliases !== undefined) {
    if (!index.facetAliases || typeof index.facetAliases !== "object" || Array.isArray(index.facetAliases)) throw new Error("Malformed facet aliases");
    for (const [id, aliases] of Object.entries(index.facetAliases)) {
      if (!QID.test(id) || !Array.isArray(aliases) || aliases.length > 1000 || aliases.some((value) => typeof value !== "string" || value.length > 10_000)) {
        throw new Error("Malformed facet aliases");
      }
    }
  }
  return index;
}

export function queryCatalogueIndex(index: CatalogueIndex, input: NormalizedSearchInput) {
  const tokens = input.q.toLocaleLowerCase("en").split(/\s+/u).filter(Boolean);
  let texts = searchTexts.get(index);
  if (tokens.length && !texts) {
    texts = index.records.map((entry) => `${entry.id} ${entry.label} ${entry.terms}`.toLocaleLowerCase("en"));
    searchTexts.set(index, texts);
  }
  const matches = index.records.filter((entry, position) =>
    facets.every((facet) => !input[facet] || entry[facet].includes(input[facet]!)) &&
    tokens.every((token) => texts![position].includes(token)),
  );
  const offset = (input.page - 1) * input.pageSize;
  return {
    qids: matches.slice(offset, offset + input.pageSize).map((entry) => entry.id),
    page: input.page,
    pageSize: input.pageSize,
    hasNextPage: offset + input.pageSize < matches.length,
    totalResults: matches.length,
  };
}

export function searchCatalogueFacets(index: CatalogueIndex, facet: CatalogueFacet, term = ""): LabeledEntity[] {
  let cached = facetChoices.get(index);
  if (!cached) { cached = new Map(); facetChoices.set(index, cached); }
  let choices = cached.get(facet);
  if (!choices) {
    const ids = new Set(index.records.flatMap((entry) => entry[facet]));
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    choices = [...ids].map((id) => ({ id, label: index.labels[id] || id, url: `${FACTGRID.wikiBase}Item:${id}` }))
      .sort((a, b) => collator.compare(a.label, b.label) || a.id.localeCompare(b.id));
    cached.set(facet, choices);
  }
  const query = term.trim().toLocaleLowerCase("en");
  return choices.filter((value) => `${value.label} ${value.id} ${(index.facetAliases?.[value.id] || []).join(" ")}`.toLocaleLowerCase("en").includes(query));
}

export function getCatalogueFacets(index: CatalogueIndex): TabletFacets {
  return {
    collections: searchCatalogueFacets(index, "collection"),
    findspots: searchCatalogueFacets(index, "findspot"),
    periods: searchCatalogueFacets(index, "period"),
  };
}
