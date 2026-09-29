import { z } from "zod";

import { TranscriptEditError } from "./errors";

export const MAX_METADATA_BODY_BYTES = 1_000_000;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const PROPERTY_ID = /^P[1-9][0-9]{0,14}$/u;
const ENTITY_ID = /^(?:Q|P|L)[1-9][0-9]{0,14}(?:-(?:F|S)[1-9][0-9]{0,14})?$/u;
const STATEMENT_ID = /^Q[1-9][0-9]{0,14}\$[A-Za-z0-9-]{1,96}$/u;
const HASH = /^[a-f0-9]{40}$/u;
const LANGUAGE = /^[A-Za-z][A-Za-z0-9-]{0,34}$/u;
const SITE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const DECIMAL = /^[+-](?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const TIME = /^[+-][0-9]{11,16}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u;

const boundedText = (maximum: number) =>
  z.string().max(maximum).refine((value) => !CONTROL_CHARACTERS.test(value), {
    message: "Control characters are not supported.",
  });

export const propertyIdSchema = z.string().regex(PROPERTY_ID);
export const statementIdSchema = z.string().regex(STATEMENT_ID);
const languageSchema = z.string().regex(LANGUAGE);

const stringValueSchema = z
  .object({ kind: z.literal("string"), value: boundedText(20_000) })
  .strict();
const entityValueSchema = z
  .object({
    kind: z.literal("entity"),
    id: z.string().regex(ENTITY_ID),
    entityType: z.enum(["item", "property", "lexeme", "form", "sense"]),
  })
  .strict();
const monolingualTextValueSchema = z
  .object({
    kind: z.literal("monolingualtext"),
    text: boundedText(20_000),
    language: languageSchema,
  })
  .strict();
const timeValueSchema = z
  .object({
    kind: z.literal("time"),
    time: z.string().regex(TIME),
    timezone: z.number().int().min(-1_440).max(1_440),
    before: z.number().int().min(0).max(1_000_000_000),
    after: z.number().int().min(0).max(1_000_000_000),
    precision: z.number().int().min(0).max(14),
    calendarModel: z.string().url().max(2_048),
  })
  .strict();
const quantityValueSchema = z
  .object({
    kind: z.literal("quantity"),
    amount: z.string().max(200).regex(DECIMAL),
    unit: z.union([z.literal("1"), z.string().url().max(2_048)]),
    lowerBound: z.string().max(200).regex(DECIMAL).optional(),
    upperBound: z.string().max(200).regex(DECIMAL).optional(),
  })
  .strict();
const coordinateValueSchema = z
  .object({
    kind: z.literal("coordinate"),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    altitude: z.number().finite().nullable(),
    precision: z.number().finite().positive().max(360),
    globe: z.string().url().max(2_048),
  })
  .strict();

export const metadataValueSchema = z.discriminatedUnion("kind", [
  stringValueSchema,
  entityValueSchema,
  monolingualTextValueSchema,
  timeValueSchema,
  quantityValueSchema,
  coordinateValueSchema,
]);

export type MetadataValue = z.infer<typeof metadataValueSchema>;

const supportedDatatypeSchema = z.enum([
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

export const metadataSnakSchema = z.discriminatedUnion("snaktype", [
  z
    .object({
      snaktype: z.literal("value"),
      property: propertyIdSchema,
      datatype: supportedDatatypeSchema,
      value: metadataValueSchema,
      hash: z.string().regex(HASH).optional(),
    })
    .strict(),
  z
    .object({
      snaktype: z.enum(["somevalue", "novalue"]),
      property: propertyIdSchema,
      datatype: supportedDatatypeSchema,
      hash: z.string().regex(HASH).optional(),
    })
    .strict(),
]);

export type MetadataSnak = z.infer<typeof metadataSnakSchema>;

const snakMapSchema = z
  .record(propertyIdSchema, z.array(metadataSnakSchema).min(1).max(50))
  .refine((value) => Object.keys(value).length <= 50, {
    message: "Too many qualifier or reference properties.",
  });

const referenceSchema = z
  .object({
    hash: z.string().regex(HASH).optional(),
    snaks: snakMapSchema.refine((value) => Object.keys(value).length > 0, {
      message: "A reference must contain at least one value.",
    }),
    snaksOrder: z.array(propertyIdSchema).max(50),
  })
  .strict();

export const metadataStatementSchema = z
  .object({
    id: statementIdSchema.optional(),
    rank: z.enum(["preferred", "normal", "deprecated"]),
    mainsnak: metadataSnakSchema,
    qualifiers: snakMapSchema,
    qualifierOrder: z.array(propertyIdSchema).max(50),
    references: z.array(referenceSchema).max(50),
  })
  .strict();

export type MetadataStatement = z.infer<typeof metadataStatementSchema>;

export const metadataOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.enum(["set-label", "set-description"]),
      language: languageSchema,
      value: boundedText(2_000).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal("set-aliases"),
      language: languageSchema,
      values: z.array(boundedText(2_000)).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("set-sitelink"),
      site: z.string().regex(SITE),
      title: boundedText(2_000).nullable(),
      badges: z.array(z.string().regex(/^Q[1-9][0-9]{0,14}$/u)).max(50).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("upsert-statement"),
      statement: metadataStatementSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("remove-statement"),
      statementId: statementIdSchema,
    })
    .strict(),
]);

export type MetadataOperation = z.infer<typeof metadataOperationSchema>;

export const metadataWriteSchema = z
  .object({
    baseRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    summary: boundedText(255).refine(
      (value) => Buffer.byteLength(value, "utf8") <= 500,
      { message: "Edit summary is too large." },
    ),
    confirmRemovals: z.boolean(),
    confirmCatalogueRemoval: z.boolean(),
    operations: z.array(metadataOperationSchema).min(1).max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !value.confirmRemovals &&
      value.operations.some(
        (operation) =>
          operation.type === "remove-statement" ||
          ((operation.type === "set-label" || operation.type === "set-description") &&
            operation.value === null) ||
          (operation.type === "set-aliases" && operation.values.length === 0) ||
          (operation.type === "set-sitelink" && operation.title === null),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Removals require deliberate confirmation.",
        path: ["confirmRemovals"],
      });
    }
  });

export type MetadataWriteRequest = z.infer<typeof metadataWriteSchema>;

function invalidRequest(message: string, cause?: unknown): TranscriptEditError {
  return new TranscriptEditError("invalid_request", message, {
    status: 400,
    cause,
  });
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const [mediaType, ...parameters] = value.split(";");
  if (mediaType.trim().toLowerCase() !== "application/json") return false;
  return parameters.every((parameter) => {
    const normalized = parameter.trim().toLowerCase();
    return normalized === "charset=utf-8" || normalized === 'charset="utf-8"';
  });
}

export async function parseMetadataWriteRequest(
  request: Request,
): Promise<MetadataWriteRequest> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new TranscriptEditError(
      "invalid_request",
      "Content-Type must be application/json with an optional UTF-8 charset.",
      { status: 415 },
    );
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidRequest("The request body length is invalid.");
    }
    if (length > MAX_METADATA_BODY_BYTES) {
      throw new TranscriptEditError("invalid_request", "The request body is too large.", {
        status: 413,
      });
    }
  }
  if (!request.body) throw invalidRequest("A JSON request body is required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_METADATA_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new TranscriptEditError("invalid_request", "The request body is too large.", {
          status: 413,
        });
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof TranscriptEditError) throw error;
    throw invalidRequest("The request body could not be read.", error);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw invalidRequest("The request body must be valid UTF-8 JSON.", error);
  }
  const result = metadataWriteSchema.safeParse(parsed);
  if (!result.success) {
    throw invalidRequest("The metadata edit request is invalid.", result.error);
  }
  return result.data;
}
