import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AuthConfiguration } from "./config";
import {
  checkOAuthRateLimit,
  oauthClientIdentity,
  OAuthRateLimiter,
} from "./auth-rate-limit";

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://interface.example/api/auth/login", { headers });
}

describe("OAuthRateLimiter", () => {
  it("limits routes independently per client and recovers after the window", () => {
    const limiter = new OAuthRateLimiter({
      loginAttempts: 2,
      callbackAttempts: 1,
      maximumBuckets: 10,
      windowMs: 1_000,
    });
    expect(limiter.check("login", "client-a", 10_000).allowed).toBe(true);
    expect(limiter.check("login", "client-a", 10_001).allowed).toBe(true);
    expect(limiter.check("login", "client-a", 10_002)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.check("callback", "client-a", 10_002).allowed).toBe(true);
    expect(limiter.check("login", "client-b", 10_002).allowed).toBe(true);
    expect(limiter.check("login", "client-a", 11_000).allowed).toBe(true);
  });

  it("bounds bucket cardinality by evicting the least recently seen identity", () => {
    const limiter = new OAuthRateLimiter({ loginAttempts: 2, maximumBuckets: 2 });
    limiter.check("login", "client-a", 1);
    limiter.check("login", "client-b", 2);
    limiter.check("login", "client-c", 3);
    expect(limiter.size).toBe(2);
    expect(limiter.check("login", "client-a", 4).allowed).toBe(true);
    expect(limiter.size).toBe(2);
  });
});

describe("trusted proxy OAuth identity", () => {
  it("ignores all client-supplied identity headers unless proxy trust is explicit", () => {
    const one = request({ "x-factgrid-client-ip": "192.0.2.10" });
    const two = request({ "x-factgrid-client-ip": "198.51.100.20" });
    expect(oauthClientIdentity(one, { trustProxy: false })).toBe(
      oauthClientIdentity(two, { trustProxy: false }),
    );
  });

  it("uses only a single valid IP value from the overwriting trusted proxy", () => {
    expect(oauthClientIdentity(
      request({ "x-factgrid-client-ip": "192.0.2.10" }),
      { trustProxy: true },
    )).toBe("proxy:192.0.2.10");
    for (const value of ["192.0.2.10, 198.51.100.20", "attacker", ""]) {
      expect(oauthClientIdentity(
        request({ "x-factgrid-client-ip": value }),
        { trustProxy: true },
      )).toBe("proxy-unidentified-client");
    }
  });

  it("returns a private 429 with an exact Retry-After value", () => {
    const configuration = { trustProxy: false } as AuthConfiguration;
    const limiter = new OAuthRateLimiter({ loginAttempts: 1, windowMs: 2_000 });
    const first = limiter.check("login", "direct-unidentified-client", 10_000);
    const second = limiter.check("login", "direct-unidentified-client", 10_001);
    expect(first.allowed).toBe(true);
    expect(second).toEqual({ allowed: false, retryAfterSeconds: 2 });

    // Exercise the production response helper through its singleton with a
    // fresh identity and then fill its configured budget.
    const identityRequest = request();
    let response = checkOAuthRateLimit(identityRequest, configuration, "login");
    for (let index = 1; index < 10; index += 1) {
      response = checkOAuthRateLimit(identityRequest, configuration, "login");
    }
    expect(response).toBeNull();
    response = checkOAuthRateLimit(identityRequest, configuration, "login");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toMatch(/^\d+$/u);
    expect(response?.headers.get("cache-control")).toContain("no-store");
  });
});
