/** Public, fixed FactGrid endpoints. They are deliberately not configurable. */
export const FACTGRID = Object.freeze({
  origin: "https://database.factgrid.de",
  api: "https://database.factgrid.de/w/api.php",
  sparql: "https://database.factgrid.de/sparql",
  entityBase: "https://database.factgrid.de/entity/",
  wikiBase: "https://database.factgrid.de/wiki/",
});

export const CUNEIFORM_CATALOGUE_QID = "Q512006" as const;

export const FACTGRID_PROPERTIES = Object.freeze({
  membership: "P2",
  title: "P11",
  language: "P18",
  dimensions: Object.freeze({
    height: "P59",
    width: "P60",
    depth: "P61",
  }),
  onlineTranscript: "P69",
  workType: "P121",
  onlineImage: "P188",
  commonsImage: "P189",
  documentPage: "P251",
  presentHolding: "P329",
  material: "P401",
  cdliId: "P692",
  findspot: "P695",
  period: "P853",
});

export const FACTGRID_LIMITS = Object.freeze({
  defaultPageSize: 20,
  maxPageSize: 25,
  maxPage: 100,
  maxQueryLength: 100,
  maxDocumentPages: 12,
  maxWbgetentitiesBatch: 50,
  timeoutMs: 8_000,
  maxResponseBytes: 3_000_000,
  maxTranscriptBytes: 500_000,
});
