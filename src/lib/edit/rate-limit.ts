import "server-only";

import { createHash } from "node:crypto";

import { TranscriptEditError } from "./errors";

export interface WriteRateLimiterOptions {
  maximumAttempts?: number;
  windowMs?: number;
  maximumSessions?: number;
}

interface RateBucket {
  startedAt: number;
  attempts: number;
  lastSeenAt: number;
}

export class WriteRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();
  private readonly maximumAttempts: number;
  private readonly windowMs: number;
  private readonly maximumSessions: number;

  constructor(options: WriteRateLimiterOptions = {}) {
    this.maximumAttempts = options.maximumAttempts ?? 5;
    this.windowMs = options.windowMs ?? 60_000;
    this.maximumSessions = options.maximumSessions ?? 1_000;
  }

  check(sessionToken: string, now = Date.now()): void {
    // Never retain the bearer-like opaque session value in process memory.
    const key = createHash("sha256").update(sessionToken, "utf8").digest("base64url");
    const existing = this.buckets.get(key);
    if (!existing || now - existing.startedAt >= this.windowMs) {
      this.makeRoom(now);
      this.buckets.set(key, { startedAt: now, attempts: 1, lastSeenAt: now });
      return;
    }

    existing.lastSeenAt = now;
    if (existing.attempts >= this.maximumAttempts) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.startedAt + this.windowMs - now) / 1_000),
      );
      throw new TranscriptEditError(
        "rate_limited",
        "Too many save attempts. Wait briefly before trying again.",
        { status: 429, retryAfterSeconds },
      );
    }
    existing.attempts += 1;
  }

  private makeRoom(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    }
    if (this.buckets.size < this.maximumSessions) return;

    let oldestKey: string | undefined;
    let oldestSeen = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeenAt < oldestSeen) {
        oldestKey = key;
        oldestSeen = bucket.lastSeenAt;
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey);
  }
}

const editGlobal = globalThis as typeof globalThis & {
  __factGridWriteRateLimiter?: WriteRateLimiter;
};

export const writeRateLimiter =
  (editGlobal.__factGridWriteRateLimiter ??= new WriteRateLimiter());
