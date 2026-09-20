import "server-only";

import {
  adaptDocumentRevision,
  adaptTabletEntity,
  collectReferencedQids,
  entityIsCuneiformTablet,
} from "./adapters";
import { FACTGRID, FACTGRID_LIMITS } from "./constants";
import { FactGridError, FactGridNotFoundError, isFactGridError } from "./errors";
import type {
  MediaWikiPage,
  MediaWikiQueryResponse,
  MediaWikiSearchResponse,
  Qid,
  SearchInput,
  SparqlResponse,
  TabletRecord,
  TabletEdition,
  TabletFacets,
  TabletSearchPage,
  WbGetEntitiesResponse,
  WikibaseEntity,
} from "./types";
import { normalizeSearchInput, parseEditionId, parseQid } from "./validation";
import {
  adaptCirrusSearchQids,
  adaptFacetQids,
  buildCirrusSearchExpression,
  buildFacetQuery,
} from "./search-query";

type ServerFetch = typeof globalThis.fetch;

export interface FactGridClientOptions {
  fetch?: ServerFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Next.js public-data revalidation time. Set false for tests or uncached reads. */
  revalidateSeconds?: number | false;
}

export interface TabletReadOptions {
  includeDocuments?: boolean;
}

function labelForEntity(entity: WikibaseEntity): string | undefined {
  return (
    entity.labels?.en?.value ??
    entity.labels?.de?.value ??
    Object.entries(entity.labels ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, term]) => term.value)
      .find((value): value is string => typeof value === "string" && value.length > 0)
  );
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function createFactGridClient(options: FactGridClientOptions = {}) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? FACTGRID_LIMITS.timeoutMs;
  const maxResponseBytes = options.maxResponseBytes ?? FACTGRID_LIMITS.maxResponseBytes;
  const revalidateSeconds = options.revalidateSeconds ?? 300;

  if (typeof fetchImpl !== "function") {
    throw new FactGridError("UPSTREAM_UNAVAILABLE", "Server fetch is unavailable.", {
      status: 503,
    });
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new FactGridError("INVALID_INPUT", "FactGrid timeout is out of range.", {
      status: 500,
    });
  }

  async function requestJson<T>(url: URL, init: RequestInit = {}): Promise<T> {
    // Defense in depth: all requests must still resolve to one of the two fixed hosts/paths.
    if (
      url.origin !== FACTGRID.origin ||
      (url.pathname !== "/w/api.php" && url.pathname !== "/sparql") ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw new FactGridError("INVALID_INPUT", "Refused an untrusted FactGrid endpoint.", {
        status: 500,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const requestInit: RequestInit = {
      ...init,
      headers: {
        "User-Agent":
          "FactGrid-Cuneiform-Interface/0.1 (+https://github.com/TokenWorks-LLC/FactGrid-Cuneifrom-Interface)",
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
      redirect: "error",
      signal: controller.signal,
    };
    if (init.cache === "no-store" || revalidateSeconds === false) requestInit.cache = "no-store";
    else requestInit.next = { revalidate: revalidateSeconds };

    try {
      const response = await fetchImpl(url, requestInit);
      if (!response.ok) {
        throw new FactGridError(
          "UPSTREAM_UNAVAILABLE",
          `FactGrid returned HTTP ${response.status}.`,
          { status: 502, retryable: response.status >= 500 },
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        throw new FactGridError(
          "UPSTREAM_RESPONSE_TOO_LARGE",
          "FactGrid returned more data than this request permits.",
          { status: 502 },
        );
      }

      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > maxResponseBytes) {
        throw new FactGridError(
          "UPSTREAM_RESPONSE_TOO_LARGE",
          "FactGrid returned more data than this request permits.",
          { status: 502 },
        );
      }
      try {
        return JSON.parse(body) as T;
      } catch (cause) {
        throw new FactGridError(
          "UPSTREAM_PROTOCOL",
          "FactGrid returned a non-JSON response.",
          { status: 502, retryable: true, cause },
        );
      }
    } catch (error) {
      if (isFactGridError(error)) throw error;
      if (controller.signal.aborted) {
        throw new FactGridError("UPSTREAM_TIMEOUT", "FactGrid did not respond in time.", {
          status: 504,
          retryable: true,
          cause: error,
        });
      }
      throw new FactGridError("UPSTREAM_UNAVAILABLE", "FactGrid could not be reached.", {
        status: 502,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function mediaWikiApi<T>(
    parameters: Record<string, string>,
    init: RequestInit = {},
  ): Promise<T> {
    const url = new URL(FACTGRID.api);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    return requestJson<T>(url, {
      ...init,
      headers: { Accept: "application/json", ...Object.fromEntries(new Headers(init.headers)) },
    });
  }

  async function getEntities(qids: readonly Qid[]): Promise<Map<Qid, WikibaseEntity>> {
    const uniqueQids = [...new Set(qids.map((qid) => parseQid(qid)))];
    const result = new Map<Qid, WikibaseEntity>();

    for (const batch of chunks(uniqueQids, FACTGRID_LIMITS.maxWbgetentitiesBatch)) {
      if (batch.length === 0) continue;
      const response = await mediaWikiApi<WbGetEntitiesResponse>({
        action: "wbgetentities",
        format: "json",
        formatversion: "2",
        props: "info|labels|descriptions|claims",
        languages: "en|de",
        languagefallback: "1",
        ids: batch.join("|"),
      });
      if (response.error || !response.entities) {
        throw new FactGridError(
          "UPSTREAM_PROTOCOL",
          response.error?.info ?? "FactGrid returned an invalid entity response.",
          { status: 502, retryable: true },
        );
      }
      for (const qid of batch) {
        const entity = response.entities[qid];
        if (!entity) {
          throw new FactGridError(
            "UPSTREAM_PROTOCOL",
            `FactGrid omitted ${qid} from its entity response.`,
            { status: 502, retryable: true },
          );
        }
        result.set(qid, entity);
      }
    }
    return result;
  }

  async function labelsFor(entities: readonly WikibaseEntity[]): Promise<Map<string, string>> {
    const ids = new Set<Qid>();
    for (const entity of entities) {
      for (const qid of collectReferencedQids(entity)) ids.add(qid);
    }
    const related = await getEntities([...ids]);
    const labels = new Map<string, string>();
    for (const [qid, entity] of related) labels.set(qid, labelForEntity(entity) ?? qid);
    return labels;
  }

  async function loadDocumentPages(record: TabletRecord): Promise<TabletRecord> {
    const references = record.editions.flatMap((edition) =>
      edition.reference ? [edition.reference] : [],
    );
    if (references.length === 0) return record;

    const response = await mediaWikiApi<MediaWikiQueryResponse>({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "revisions",
      rvlimit: "1",
      rvprop: "ids|timestamp|content|contentmodel",
      rvslots: "main",
      titles: references.map((reference) => reference.title).join("|"),
    });
    if (response.error || !Array.isArray(response.query?.pages)) {
      throw new FactGridError(
        "UPSTREAM_PROTOCOL",
        response.error?.info ?? "FactGrid returned an invalid revision response.",
        { status: 502, retryable: true },
      );
    }

    const pages = new Map<string, MediaWikiPage>();
    for (const page of response.query.pages) {
      if (typeof page.title === "string") pages.set(page.title.replaceAll("_", " "), page);
    }
    return {
      ...record,
      editions: record.editions.map((edition) =>
        adaptDocumentRevision(
          edition,
          edition.reference ? pages.get(edition.reference.title) : undefined,
        ),
      ),
    };
  }

  async function getTablet(
    qidValue: string,
    readOptions: TabletReadOptions = {},
  ): Promise<TabletRecord> {
    const qid = parseQid(qidValue);
    const entities = await getEntities([qid]);
    const entity = entities.get(qid);
    if (!entity || entity.missing) throw new FactGridNotFoundError(qid);
    if (!entityIsCuneiformTablet(entity)) throw new FactGridNotFoundError(qid, true);

    const labels = await labelsFor([entity]);
    const record = adaptTabletEntity(entity, labels);
    return readOptions.includeDocuments === false ? record : loadDocumentPages(record);
  }

  async function resolveCurrentEdition(
    qidValue: string,
    editionIdValue: string,
  ): Promise<TabletEdition> {
    const qid = parseQid(qidValue);
    const editionId = parseEditionId(editionIdValue, qid);
    // This deliberately re-reads the item. A client-provided URL/title is never accepted.
    const record = await getTablet(qid, { includeDocuments: false });
    const edition = record.editions.find(
      (candidate) => candidate.editionId === editionId && candidate.reference,
    );
    if (!edition) {
      throw new FactGridError(
        "UNSUPPORTED_DOCUMENT",
        "The selected P251 edition is no longer attached to this tablet.",
        { status: 409 },
      );
    }
    return edition;
  }

  async function searchTablets(input: SearchInput = {}): Promise<TabletSearchPage> {
    const normalized = normalizeSearchInput(input);
    const rawLimit = Math.min(normalized.pageSize + 5, 50);
    const response = await mediaWikiApi<MediaWikiSearchResponse>(
      {
        action: "query",
        format: "json",
        formatversion: "2",
        list: "search",
        srnamespace: "120",
        srsearch: buildCirrusSearchExpression(normalized),
        srprop: "",
        srlimit: String(rawLimit),
        sroffset: String((normalized.page - 1) * normalized.pageSize),
        // A fixed timestamp order gives browse and filtered URLs stable page boundaries.
        srsort: "create_timestamp_asc",
      },
      // Do not populate a persistent Next.js cache with arbitrary search strings.
      { cache: "no-store" },
    );
    if (response.error) {
      throw new FactGridError(
        "UPSTREAM_PROTOCOL",
        response.error.info ?? "FactGrid search failed.",
        { status: 502, retryable: true },
      );
    }
    const search = adaptCirrusSearchQids(response);
    if (search.qids.length === 0) {
      return {
        results: [],
        page: normalized.page,
        pageSize: normalized.pageSize,
        hasNextPage: false,
      };
    }

    const entityMap = await getEntities(search.qids);
    // CirrusSearch is an index. Revalidate the current, non-deprecated P2 claim.
    const validQids = search.qids.filter((qid) => {
      const entity = entityMap.get(qid);
      return Boolean(entity && !entity.missing && entityIsCuneiformTablet(entity));
    });
    // Fill the page from the validated look-ahead buffer instead of leaving a
    // hole when CirrusSearch briefly retains a stale membership result.
    const visibleQids = validQids.slice(0, normalized.pageSize);
    const entities = visibleQids.map((qid) => entityMap.get(qid) as WikibaseEntity);
    const labels = await labelsFor(entities);
    const records = entities.map((entity) => adaptTabletEntity(entity, labels));

    return {
      results: records.map((record) => ({
        qid: record.qid,
        title: record.title,
        description: record.description,
        factGridUrl: record.factGridUrl,
        cdliIds: record.cdliIds,
        holdings: record.holdings,
        findspots: record.findspots,
        periods: record.periods,
      })),
      page: normalized.page,
      pageSize: normalized.pageSize,
      hasNextPage:
        search.hasContinuation || validQids.length > normalized.pageSize,
    };
  }

  async function facetQids(property: "P329" | "P695" | "P853"): Promise<Qid[]> {
    const query = buildFacetQuery(property);
    const response = await requestJson<SparqlResponse>(new URL(FACTGRID.sparql), {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({ query }),
    });
    return adaptFacetQids(response);
  }

  async function getTabletFacets(): Promise<TabletFacets> {
    const [collections, findspots, periods] = await Promise.all([
      facetQids("P329"),
      facetQids("P695"),
      facetQids("P853"),
    ]);
    const ids = [...new Set([...collections, ...findspots, ...periods])];
    const entities = await getEntities(ids);
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const mapValues = (values: Qid[]) =>
      values
        .map((id) => ({
          id,
          label: labelForEntity(entities.get(id) ?? {}) ?? id,
          url: `${FACTGRID.wikiBase}Item:${id}`,
        }))
        .sort((left, right) => collator.compare(left.label, right.label) || left.id.localeCompare(right.id));

    return {
      collections: mapValues(collections),
      findspots: mapValues(findspots),
      periods: mapValues(periods),
    };
  }

  return Object.freeze({ getTablet, getTabletFacets, resolveCurrentEdition, searchTablets });
}

const defaultClient = createFactGridClient();

export const getTablet = defaultClient.getTablet;
export const getTabletFacets = defaultClient.getTabletFacets;
export const resolveCurrentEdition = defaultClient.resolveCurrentEdition;
export const searchTablets = defaultClient.searchTablets;
