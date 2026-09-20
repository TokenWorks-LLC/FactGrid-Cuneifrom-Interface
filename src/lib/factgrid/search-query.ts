import { CUNEIFORM_CATALOGUE_QID, FACTGRID, FACTGRID_PROPERTIES } from "./constants";
import { FactGridError } from "./errors";
import type {
  MediaWikiSearchResponse,
  NormalizedSearchInput,
  PropertyId,
  Qid,
  SparqlResponse,
} from "./types";
import { parseQid } from "./validation";

const PREFIXES = `PREFIX wd: <${FACTGRID.entityBase}>
PREFIX wdt: <${FACTGRID.origin}/prop/direct/>`;

function cirrusLiteral(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Builds a literal-only CirrusSearch expression; user text cannot add operators. */
export function buildCirrusSearchExpression(input: NormalizedSearchInput): string {
  const clauses = [`haswbstatement:${FACTGRID_PROPERTIES.membership}=${CUNEIFORM_CATALOGUE_QID}`];
  if (input.collection) {
    clauses.push(`haswbstatement:${FACTGRID_PROPERTIES.presentHolding}=${input.collection}`);
  }
  if (input.findspot) {
    clauses.push(`haswbstatement:${FACTGRID_PROPERTIES.findspot}=${input.findspot}`);
  }
  if (input.period) {
    clauses.push(`haswbstatement:${FACTGRID_PROPERTIES.period}=${input.period}`);
  }
  if (input.q) {
    // Quoting whitespace-delimited tokens retains useful identifier/name search
    // while preventing haswbstatement, namespace, wildcard, or regex injection.
    clauses.push(...input.q.split(/\s+/u).filter(Boolean).map(cirrusLiteral));
  }
  return clauses.join(" ");
}

export function adaptCirrusSearchQids(response: MediaWikiSearchResponse): {
  qids: Qid[];
  hasContinuation: boolean;
} {
  const search = response.query?.search;
  if (!Array.isArray(search)) {
    throw new FactGridError(
      "UPSTREAM_PROTOCOL",
      "FactGrid returned an invalid search response.",
      { status: 502, retryable: true },
    );
  }
  const qids = search.map((result) => {
    if (result.ns !== 120 || typeof result.title !== "string" || !result.title.startsWith("Item:")) {
      throw new FactGridError(
        "UPSTREAM_PROTOCOL",
        "FactGrid returned a malformed catalogue search result.",
        { status: 502, retryable: true },
      );
    }
    return parseQid(result.title.slice("Item:".length), "Search result QID");
  });
  return { qids, hasContinuation: typeof response.continue?.sroffset === "number" };
}

export function buildFacetQuery(property: PropertyId): string {
  if (
    !(
      [
        FACTGRID_PROPERTIES.presentHolding,
        FACTGRID_PROPERTIES.findspot,
        FACTGRID_PROPERTIES.period,
      ] as readonly string[]
    ).includes(property)
  ) {
    throw new FactGridError("INVALID_INPUT", "Unsupported FactGrid facet property.", {
      status: 500,
    });
  }
  return `${PREFIXES}
SELECT DISTINCT ?value
WHERE {
  ?item wdt:${FACTGRID_PROPERTIES.membership} wd:${CUNEIFORM_CATALOGUE_QID} .
  ?item wdt:${property} ?value .
  FILTER(STRSTARTS(STR(?value), "${FACTGRID.entityBase}"))
}
ORDER BY STR(?value)
LIMIT 200`;
}

export function adaptFacetQids(response: SparqlResponse): Qid[] {
  const bindings = response.results?.bindings;
  if (!Array.isArray(bindings)) {
    throw new FactGridError(
      "UPSTREAM_PROTOCOL",
      "FactGrid returned an invalid facet response.",
      { status: 502, retryable: true },
    );
  }
  return bindings.map((binding) => {
    const value = binding.value;
    if (value?.type !== "uri" || typeof value.value !== "string" || !value.value.startsWith(FACTGRID.entityBase)) {
      throw new FactGridError(
        "UPSTREAM_PROTOCOL",
        "FactGrid returned a malformed facet value.",
        { status: 502, retryable: true },
      );
    }
    return parseQid(value.value.slice(FACTGRID.entityBase.length), "Facet QID");
  });
}
