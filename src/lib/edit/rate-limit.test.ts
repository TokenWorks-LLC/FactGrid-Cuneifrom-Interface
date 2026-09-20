import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { WriteRateLimiter } from "./rate-limit";

describe("WriteRateLimiter", () => {
  it("limits each opaque session independently and resets after the window", () => {
    const limiter = new WriteRateLimiter({ maximumAttempts: 2, windowMs: 1_000 });
    limiter.check("session-a", 10_000);
    limiter.check("session-a", 10_001);
    limiter.check("session-b", 10_002);

    expect(() => limiter.check("session-a", 10_003)).toThrowError(
      expect.objectContaining({ code: "rate_limited", status: 429 }),
    );
    expect(() => limiter.check("session-a", 11_000)).not.toThrow();
  });
});
