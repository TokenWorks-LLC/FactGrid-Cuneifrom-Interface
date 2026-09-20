import { describe, expect, it } from "vitest";

import { TranscriptEditError } from "./errors";
import {
  MAX_WRITE_BODY_BYTES,
  parseTranscriptWriteRequest,
} from "./request";

function jsonRequest(value: unknown, contentType = "application/json"): Request {
  return new Request("https://app.example/api/write", {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(value),
  });
}

describe("parseTranscriptWriteRequest", () => {
  it("accepts only the strict write contract", async () => {
    await expect(
      parseTranscriptWriteRequest(
        jsonRequest(
          { baseRevision: 42, text: "ša\nṭu", summary: "Correct signs" },
          "application/json; charset=UTF-8",
        ),
      ),
    ).resolves.toEqual({
      baseRevision: 42,
      text: "ša\nṭu",
      summary: "Correct signs",
    });

    await expect(
      parseTranscriptWriteRequest(
        jsonRequest({
          baseRevision: 42,
          text: "ša",
          summary: "Correct signs",
          title: "User:Attacker/Target",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  });

  it("rejects unsupported media types and malformed JSON", async () => {
    await expect(
      parseTranscriptWriteRequest(jsonRequest({}, "text/plain")),
    ).rejects.toMatchObject({ status: 415 });

    await expect(
      parseTranscriptWriteRequest(
        new Request("https://app.example/api/write", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{",
        }),
      ),
    ).rejects.toBeInstanceOf(TranscriptEditError);
  });

  it("enforces the byte limit before trusting Content-Length", async () => {
    await expect(
      parseTranscriptWriteRequest(
        new Request("https://app.example/api/write", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(MAX_WRITE_BODY_BYTES + 1),
          },
          body: "{}",
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });

    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_WRITE_BODY_BYTES));
        controller.enqueue(new Uint8Array(1));
        controller.close();
      },
    });
    await expect(
      parseTranscriptWriteRequest(
        new Request("https://app.example/api/write", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: oversized,
          duplex: "half",
        } as RequestInit & { duplex: "half" }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});
