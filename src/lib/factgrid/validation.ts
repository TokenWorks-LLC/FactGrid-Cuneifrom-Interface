import { FACTGRID_LIMITS } from "./constants";
import { FactGridInputError } from "./errors";
import type { NormalizedSearchInput, Qid, SearchInput } from "./types";

const QID_PATTERN = /^Q[1-9][0-9]{0,14}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function parseQid(value: unknown, field = "QID"): Qid {
  if (typeof value !== "string" || !QID_PATTERN.test(value.trim())) {
    throw new FactGridInputError(`${field} must be a valid FactGrid QID.`);
  }
  return value.trim().toUpperCase() as Qid;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new FactGridInputError(`${field} must be an integer.`);
  }
  if (value < minimum || value > maximum) {
    throw new FactGridInputError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function normalizeSearchInput(input: SearchInput = {}): NormalizedSearchInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new FactGridInputError("Search parameters must be an object.");
  }

  const q = input.q?.trim() ?? "";
  if (q.length > FACTGRID_LIMITS.maxQueryLength || CONTROL_CHARACTERS.test(q)) {
    throw new FactGridInputError(
      `Search text must be at most ${FACTGRID_LIMITS.maxQueryLength} characters and contain no control characters.`,
    );
  }

  return {
    q,
    collection:
      input.collection === undefined
        ? undefined
        : parseQid(input.collection, "Collection"),
    findspot:
      input.findspot === undefined
        ? undefined
        : parseQid(input.findspot, "Findspot"),
    period:
      input.period === undefined ? undefined : parseQid(input.period, "Period"),
    page: boundedInteger(input.page, 1, 1, FACTGRID_LIMITS.maxPage, "Page"),
    pageSize: boundedInteger(
      input.pageSize,
      FACTGRID_LIMITS.defaultPageSize,
      1,
      FACTGRID_LIMITS.maxPageSize,
      "Page size",
    ),
  };
}

export function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FactGridInputError(`${field} must be a positive integer.`);
  }
  return value;
}

export function parseEditionId(value: unknown, qid: Qid): string {
  if (
    typeof value !== "string" ||
    value.length > 120 ||
    !new RegExp(`^${qid}\\$[A-Za-z0-9-]+$`).test(value)
  ) {
    throw new FactGridInputError("Edition ID is not a valid P251 statement identifier.");
  }
  return value;
}
