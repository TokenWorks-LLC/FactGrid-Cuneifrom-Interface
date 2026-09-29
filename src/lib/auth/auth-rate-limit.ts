import "server-only";

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest, NextResponse } from "next/server";

import type { AuthConfiguration } from "./config";
import { TRUSTED_PROXY_CLIENT_IP_HEADER } from "./constants";
import { privateJson } from "./responses";

export type OAuthRateLimitKind = "login" | "callback";

interface RateBucket {
  attempts: number;
  startedAt: number;
  lastSeenAt: number;
}

export interface OAuthRateLimiterOptions {
  callbackAttempts?: number;
  loginAttempts?: number;
  maximumBuckets?: number;
  windowMs?: number;
}

export interface OAuthRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export class OAuthRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly callbackAttempts: number;
  private readonly loginAttempts: number;
  private readonly maximumBuckets: number;
  private readonly windowMs: number;

  constructor(options: OAuthRateLimiterOptions = {}) {
    this.callbackAttempts = options.callbackAttempts ?? 20;
    this.loginAttempts = options.loginAttempts ?? 10;
    this.maximumBuckets = options.maximumBuckets ?? 10_000;
    this.windowMs = options.windowMs ?? 60_000;
  }

  get size(): number {
    return this.buckets.size;
  }

  clear(): void {
    this.buckets.clear();
  }

  check(
    kind: OAuthRateLimitKind,
    clientIdentity: string,
    now = Date.now(),
  ): OAuthRateLimitResult {
    const identityHash = createHash("sha256")
      .update(clientIdentity, "utf8")
      .digest("base64url");
    const key = `${kind}:${identityHash}`;
    const maximumAttempts = kind === "login"
      ? this.loginAttempts : this.callbackAttempts;
    const existing = this.buckets.get(key);
    if (!existing || now - existing.startedAt >= this.windowMs) {
      this.makeRoom(now);
      this.buckets.set(key, { attempts: 1, startedAt: now, lastSeenAt: now });
      return { allowed: true };
    }

    existing.lastSeenAt = now;
    if (existing.attempts >= maximumAttempts) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.startedAt + this.windowMs - now) / 1_000),
        ),
      };
    }
    existing.attempts += 1;
    return { allowed: true };
  }

  private makeRoom(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maximumBuckets) return;

    let oldestKey: string | undefined;
    let oldestSeenAt = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeenAt < oldestSeenAt) {
        oldestKey = key;
        oldestSeenAt = bucket.lastSeenAt;
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey);
  }
}

export function oauthClientIdentity(
  request: NextRequest,
  configuration: Pick<AuthConfiguration, "trustProxy">,
): string {
  if (!configuration.trustProxy) return "direct-unidentified-client";
  const value = request.headers.get(TRUSTED_PROXY_CLIENT_IP_HEADER)?.trim() ?? "";
  return isIP(value) ? `proxy:${value}` : "proxy-unidentified-client";
}

const authGlobal = globalThis as typeof globalThis & {
  __factGridOAuthRateLimiter?: OAuthRateLimiter;
};

export const oauthRateLimiter =
  (authGlobal.__factGridOAuthRateLimiter ??= new OAuthRateLimiter());

export function checkOAuthRateLimit(
  request: NextRequest,
  configuration: AuthConfiguration,
  kind: OAuthRateLimitKind,
): NextResponse | null {
  const result = oauthRateLimiter.check(
    kind,
    oauthClientIdentity(request, configuration),
  );
  if (result.allowed) return null;

  const response = privateJson(
    {
      error: {
        code: "rate_limited",
        message: "Too many sign-in attempts. Wait briefly before trying again.",
      },
    },
    { status: 429 },
  );
  response.headers.set("Retry-After", String(result.retryAfterSeconds ?? 1));
  return response;
}
