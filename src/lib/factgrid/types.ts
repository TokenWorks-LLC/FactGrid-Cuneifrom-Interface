export type Qid = `Q${number}`;
export type PropertyId = `P${number}`;

export interface SearchInput {
  q?: string;
  collection?: string;
  findspot?: string;
  period?: string;
  page?: number;
  pageSize?: number;
}

export interface NormalizedSearchInput {
  q: string;
  collection?: Qid;
  findspot?: Qid;
  period?: Qid;
  page: number;
  pageSize: number;
}

export interface LabeledEntity {
  id: Qid;
  label: string;
  url: string;
}

export type EditionKind = "d" | "cdli" | "oracc" | "unicode" | "other";

export interface DocumentReference {
  kind: EditionKind;
  qid: Qid;
  title: string;
  url: string;
}

export interface InvalidDocumentReference {
  status: "invalid";
  reason: "untrusted-url" | "wrong-record" | "invalid-title";
}

export interface ParsedWikitextSection {
  heading: string;
  level: number;
  wikitext: string;
}

export interface TranscriptRegion {
  format: "plain-poem-v1" | "mixed-wikitext" | "structured-lines";
  content: string;
  displayText: string;
  editable: boolean;
  start: number;
  end: number;
  reason?: string;
}

export interface DocumentRevision {
  revisionId: number;
  parentRevisionId: number;
  timestamp: string;
  contentModel: string;
  contentFormat: string;
  source: string;
  sections: ParsedWikitextSection[];
  transcript: TranscriptRegion | null;
}

export type EditionReadStatus =
  | "loaded"
  | "linked"
  | "missing"
  | "unsupported"
  | "invalid";

export interface TabletEdition {
  /** Stable P251 statement GUID. Missing GUIDs are never eligible for edits. */
  editionId?: string;
  kind: EditionKind | "invalid";
  label: string;
  status: EditionReadStatus;
  reference?: DocumentReference;
  revision?: DocumentRevision;
  reason?: string;
}

export interface DimensionValue {
  kind: "height" | "width" | "depth";
  property: PropertyId;
  amount: string;
  unit?: LabeledEntity;
}

export interface SourceLink {
  kind: "online-image" | "commons-image" | "external-transcript";
  label: string;
  url: string;
}

export interface TabletRecord {
  qid: Qid;
  title: string;
  description?: string;
  factGridUrl: string;
  revisionId?: number;
  modified?: string;
  cdliIds: string[];
  holdings: LabeledEntity[];
  findspots: LabeledEntity[];
  periods: LabeledEntity[];
  languages: LabeledEntity[];
  workTypes: LabeledEntity[];
  materials: LabeledEntity[];
  dimensions: DimensionValue[];
  images: SourceLink[];
  externalTranscripts: SourceLink[];
  editions: TabletEdition[];
  omittedEditionCount: number;
}

export type TabletSearchResult = Pick<
  TabletRecord,
  | "qid"
  | "title"
  | "description"
  | "factGridUrl"
  | "cdliIds"
  | "holdings"
  | "findspots"
  | "periods"
>;

export interface TabletSearchPage {
  results: TabletSearchResult[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export interface TabletFacets {
  collections: LabeledEntity[];
  findspots: LabeledEntity[];
  periods: LabeledEntity[];
}

export interface WikibaseDataValue {
  type?: string;
  value?: unknown;
}

export interface WikibaseSnak {
  snaktype?: string;
  property?: string;
  datatype?: string;
  datavalue?: WikibaseDataValue;
}

export interface WikibaseStatement {
  id?: string;
  rank?: "preferred" | "normal" | "deprecated";
  mainsnak?: WikibaseSnak;
}

export interface WikibaseTerm {
  language?: string;
  value?: string;
}

export interface WikibaseEntity {
  id?: string;
  type?: string;
  missing?: boolean;
  pageid?: number;
  title?: string;
  lastrevid?: number;
  modified?: string;
  labels?: Record<string, WikibaseTerm>;
  descriptions?: Record<string, WikibaseTerm>;
  claims?: Record<string, WikibaseStatement[]>;
}

export interface WbGetEntitiesResponse {
  success?: number;
  error?: { code?: string; info?: string };
  entities?: Record<string, WikibaseEntity>;
}

export interface SparqlBindingValue {
  type?: string;
  value?: string;
}

export interface SparqlResponse {
  head?: { vars?: string[] };
  results?: { bindings?: Array<Record<string, SparqlBindingValue>> };
}

export interface MediaWikiRevisionSlot {
  contentmodel?: string;
  contentformat?: string;
  content?: string;
}

export interface MediaWikiRevision {
  revid?: number;
  parentid?: number;
  timestamp?: string;
  slots?: { main?: MediaWikiRevisionSlot };
}

export interface MediaWikiPage {
  pageid?: number;
  ns?: number;
  title?: string;
  missing?: boolean;
  invalid?: boolean;
  revisions?: MediaWikiRevision[];
}

export interface MediaWikiQueryResponse {
  batchcomplete?: boolean;
  error?: { code?: string; info?: string };
  query?: { pages?: MediaWikiPage[] };
}

export interface MediaWikiSearchResult {
  ns?: number;
  title?: string;
  pageid?: number;
}

export interface MediaWikiSearchResponse {
  batchcomplete?: boolean;
  continue?: { sroffset?: number; continue?: string };
  error?: { code?: string; info?: string };
  query?: { search?: MediaWikiSearchResult[] };
}
