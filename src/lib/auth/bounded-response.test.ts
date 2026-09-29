import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  bufferBoundedResponse,
  readBoundedResponseBytes,
  readBoundedResponseText,
} from "./bounded-response";

describe("bounded OAuth responses", () => {
  it("rejects a declared oversized response before reading it", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, { headers: { "content-length": "11" } });

    await expect(readBoundedResponseBytes(response, 10)).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("counts streamed UTF-8 bytes and cancels a chunked overflow", async () => {
    const chunks = [
      new TextEncoder().encode("éé"),
      new TextEncoder().encode("é"),
    ];
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    });

    await expect(
      readBoundedResponseText(new Response(body), 5),
    ).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects malformed UTF-8 under the byte cap", async () => {
    const response = new Response(new Uint8Array([0xc3, 0x28]));
    await expect(readBoundedResponseText(response, 10)).rejects.toThrow("valid UTF-8");
  });

  it("preserves response metadata when buffering for oauth4webapi", async () => {
    const original = new Response('{"ok":true}', {
      status: 401,
      statusText: "Unauthorized",
      headers: {
        "content-type": "application/json",
        "www-authenticate": 'Bearer error="invalid_token"',
      },
    });
    const buffered = await bufferBoundedResponse(original, 1024);

    expect(buffered.status).toBe(401);
    expect(buffered.statusText).toBe("Unauthorized");
    expect(buffered.headers.get("content-type")).toBe("application/json");
    expect(buffered.headers.get("www-authenticate")).toContain("invalid_token");
    await expect(buffered.json()).resolves.toEqual({ ok: true });
  });
});
