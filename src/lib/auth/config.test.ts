import { describe, expect, it } from "vitest";

import {
  getAuthConfiguration,
  parseAllowedEditors,
  sanitizeReturnPath,
} from "./config";
import {
  FACTGRID_OAUTH_AUTHORIZE_URL,
  FACTGRID_OAUTH_PROFILE_URL,
  FACTGRID_OAUTH_TOKEN_URL,
} from "./constants";

const completeEnvironment = {
  APP_ORIGIN: "http://127.0.0.1:3000",
  FACTGRID_OAUTH_CALLBACK_URL: "http://127.0.0.1:3000/api/auth/callback",
  FACTGRID_OAUTH_CLIENT_ID: "client-id",
  FACTGRID_OAUTH_CLIENT_SECRET: "client-secret",
  FACTGRID_SESSION_DB_PATH: ":memory:",
  SESSION_SECRET: "s".repeat(32),
  NODE_ENV: "test",
};

describe("getAuthConfiguration", () => {
  it("fails closed when required settings are missing", () => {
    const result = getAuthConfiguration({});
    expect(result.available).toBe(false);
    if (result.available) throw new Error("expected unavailable auth");
    expect(result.missing).toContain("FACTGRID_OAUTH_CLIENT_ID");
    expect(result.missing).toContain("SESSION_SECRET");
  });

  it("uses only the fixed verified FactGrid endpoints", () => {
    const result = getAuthConfiguration(completeEnvironment);
    expect(result.available).toBe(true);
    if (!result.available) throw new Error("expected available auth");
    expect(result.config.oauth.authorizationEndpoint).toBe(FACTGRID_OAUTH_AUTHORIZE_URL);
    expect(result.config.oauth.tokenEndpoint).toBe(FACTGRID_OAUTH_TOKEN_URL);
    expect(result.config.oauth.profileEndpoint).toBe(FACTGRID_OAUTH_PROFILE_URL);
    expect(result.config.callbackUrl).toBe(completeEnvironment.FACTGRID_OAUTH_CALLBACK_URL);
    expect(result.config.contributorPolicy).toBe("restricted");
  });

  it("requires separate consumer credentials when OAuth 1.0a is selected", () => {
    const missing = getAuthConfiguration({ ...completeEnvironment, FACTGRID_OAUTH_VERSION: "1.0a" });
    expect(missing).toMatchObject({ available: false, missing: ["FACTGRID_OAUTH_CONSUMER_KEY", "FACTGRID_OAUTH_CONSUMER_SECRET"] });
    const result = getAuthConfiguration({
      ...completeEnvironment,
      FACTGRID_OAUTH_VERSION: "1.0a",
      FACTGRID_OAUTH_CONSUMER_KEY: "consumer-key",
      FACTGRID_OAUTH_CONSUMER_SECRET: "consumer-secret",
    });
    expect(result).toMatchObject({ available: true, config: {
      oauthVersion: "1.0a", clientId: "consumer-key", clientSecret: "consumer-secret",
      oauth: { profileEndpoint: "https://database.factgrid.de/w/index.php?title=Special:OAuth/identify" },
    } });
    expect(getAuthConfiguration({ ...completeEnvironment, FACTGRID_OAUTH_VERSION: "1" })).toMatchObject({ available: false, invalid: ["FACTGRID_OAUTH_VERSION"] });
  });

  it("rejects a callback outside the exact callback route and origin", () => {
    const wrongOrigin = getAuthConfiguration({
      ...completeEnvironment,
      FACTGRID_OAUTH_CALLBACK_URL: "http://localhost:3000/api/auth/callback",
    });
    const wrongPath = getAuthConfiguration({
      ...completeEnvironment,
      FACTGRID_OAUTH_CALLBACK_URL: "http://127.0.0.1:3000/callback",
    });
    expect(wrongOrigin.available).toBe(false);
    expect(wrongPath.available).toBe(false);
  });

  it("requires HTTPS outside loopback development", () => {
    const result = getAuthConfiguration({
      ...completeEnvironment,
      NODE_ENV: "production",
    });
    expect(result.available).toBe(false);
  });

  it("accepts only explicit contributor policy values", () => {
    expect(getAuthConfiguration({
      ...completeEnvironment,
      FACTGRID_CONTRIBUTOR_POLICY: "authenticated",
    })).toMatchObject({ available: true, config: { contributorPolicy: "authenticated" } });
    expect(getAuthConfiguration({
      ...completeEnvironment,
      FACTGRID_CONTRIBUTOR_POLICY: "open",
    })).toMatchObject({ available: false, invalid: ["FACTGRID_CONTRIBUTOR_POLICY"] });
  });
});

describe("return paths and editor configuration", () => {
  it.each([
    ["/tablets/Q499899?edition=1#text", "/tablets/Q499899?edition=1#text"],
    ["https://evil.example/path", "/"],
    ["//evil.example/path", "/"],
    ["/\\evil.example/path", "/"],
    ["javascript:alert(1)", "/"],
    [`/${"a".repeat(2_049)}`, "/"],
    [null, "/"],
  ])("normalizes %s to a relative-only destination", (value, expected) => {
    expect(sanitizeReturnPath(value)).toBe(expected);
  });

  it("keeps editor usernames exact and removes empty entries", () => {
    expect([...parseAllowedEditors("Alice, Bob Smith, ,alice")]).toEqual([
      "Alice",
      "Bob Smith",
      "alice",
    ]);
  });
});
