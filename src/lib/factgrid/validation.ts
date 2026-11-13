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

  const pageSize = boundedInteger(input.pageSize, FACTGRID_LIMITS.defaultPageSize, 1, FACTGRID_LIMITS.maxPageSize, "Page size");
  if (input.catalogueVersion !== undefined &&
      (typeof input.catalogueVersion !== "string" || input.catalogueVersion.length > 40 ||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(input.catalogueVersion) ||
       !Number.isFinite(Date.parse(input.catalogueVersion)))) {
    throw new FactGridInputError("Catalogue version must be a valid scan timestamp.");
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
    language:
      input.language === undefined ? undefined : parseQid(input.language, "Language"),
    workType:
      input.workType === undefined ? undefined : parseQid(input.workType, "Type of work"),
    material:
      input.material === undefined ? undefined : parseQid(input.material, "Material"),
    // Bound arithmetic rather than the corpus. Provider fallback has its own
    // verified deep-offset restriction; snapshot navigation has no page cap.
    page: boundedInteger(input.page, 1, 1, Math.floor(Number.MAX_SAFE_INTEGER / pageSize), "Page"),
    pageSize,
    ...(input.catalogueVersion ? { catalogueVersion: input.catalogueVersion } : {}),
  };
}

export function parsePositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new FactGridInputError(`${field} must be a positive integer.`);
  }
  return value;
}

export function parseEditionId(value: unknown, qid: Qid): string {
  const separator = typeof value === "string" ? value.indexOf("$") : -1;
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 200 ||
    CONTROL_CHARACTERS.test(value) ||
    separator <= 0 ||
    separator >= value.length - 1 ||
    value.slice(0, separator).toUpperCase() !== qid
  ) {
    throw new FactGridInputError("Edition ID is not a valid P251 statement identifier.");
  }
  return value;
}
