import { z } from "zod";

import { FACTGRID_LIMITS } from "@/lib/factgrid/constants";

import { TranscriptEditError } from "./errors";

// The JSON encoding can be larger than the UTF-8 transcript because JSON must
// escape quotes and backslashes. The transcript itself is checked separately.
export const MAX_WRITE_BODY_BYTES = FACTGRID_LIMITS.maxTranscriptBytes * 2 + 8_192;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export const transcriptWriteSchema = z
  .object({
    baseRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    text: z.string().max(FACTGRID_LIMITS.maxTranscriptBytes),
    summary: z
      .string()
      .max(255)
      .refine((value) => !CONTROL_CHARACTERS.test(value), {
        message: "Edit summary contains unsupported control characters.",
      })
      .refine((value) => Buffer.byteLength(value, "utf8") <= 500, {
        message: "Edit summary is too large.",
      }),
  })
  .strict();

export type TranscriptWriteRequest = z.infer<typeof transcriptWriteSchema>;

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
    return normalized === "charset=utf-8" || normalized === "charset=\"utf-8\"";
  });
}

async function readBodyBytes(request: Request, limit: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw invalidRequest("The request body length is invalid.");
    }
    if (parsedLength > limit) {
      throw new TranscriptEditError(
        "invalid_request",
        "The request body is too large.",
        { status: 413 },
      );
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
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new TranscriptEditError(
          "invalid_request",
          "The request body is too large.",
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof TranscriptEditError) throw error;
    throw invalidRequest("The request body could not be read.", error);
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function parseTranscriptWriteRequest(
  request: Request,
): Promise<TranscriptWriteRequest> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new TranscriptEditError(
      "invalid_request",
      "Content-Type must be application/json with an optional UTF-8 charset.",
      { status: 415 },
    );
  }

  const bytes = await readBodyBytes(request, MAX_WRITE_BODY_BYTES);
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw invalidRequest("The request body must be valid UTF-8.", error);
  }

  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch (error) {
    throw invalidRequest("The request body must be valid JSON.", error);
  }

  const parsed = transcriptWriteSchema.safeParse(json);
  if (!parsed.success) {
    throw invalidRequest("The transcript edit request is invalid.", parsed.error);
  }
  return parsed.data;
}
