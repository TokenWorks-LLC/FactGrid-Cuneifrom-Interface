import * as oauth from "oauth4webapi";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAuthConfiguration } from "./config";
import {
  buildAuthorizationUrl,
  fetchFactGridProfile,
  validateAuthorizationCallback,
} from "./oauth";

afterEach(() => vi.unstubAllGlobals());

function configuration() {
  const result = getAuthConfiguration({
    APP_ORIGIN: "https://interface.example",
    FACTGRID_OAUTH_CALLBACK_URL: "https://interface.example/api/auth/callback",
    FACTGRID_OAUTH_CLIENT_ID: "client-id",
    FACTGRID_OAUTH_CLIENT_SECRET: "client-secret",
    FACTGRID_SESSION_DB_PATH: ":memory:",
    SESSION_SECRET: "s".repeat(32),
    NODE_ENV: "production",
  });
  if (!result.available) throw new Error("test auth configuration is invalid");
  return result.config;
}

describe("OAuth authorization request", () => {
  it("always uses S256 PKCE, state, and the exact callback", async () => {
    const state = oauth.generateRandomState();
    const verifier = oauth.generateRandomCodeVerifier();
    const url = await buildAuthorizationUrl(configuration(), state, verifier);

    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://interface.example/api/auth/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(
      await oauth.calculatePKCECodeChallenge(verifier),
    );
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("accepts the exact state and rejects a mismatch", () => {
    const state = oauth.generateRandomState();
    const valid = new URL(
      `https://interface.example/api/auth/callback?code=code&state=${state}`,
    );
    expect(validateAuthorizationCallback(valid, state, configuration()).get("code")).toBe(
      "code",
    );

    expect(() =>
      validateAuthorizationCallback(valid, oauth.generateRandomState(), configuration()),
    ).toThrow();
  });
});

describe("FactGrid profile", () => {
  it("uses a Bearer header and accepts a numeric stable ID", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: "Bearer provider-token" });
      return Response.json({
        sub: 42,
        username: "Scholar",
        blocked: false,
        groups: ["user"],
        rights: ["read", "edit"],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFactGridProfile("provider-token", configuration())).resolves.toEqual({
      providerUserId: "42",
      username: "Scholar",
      blocked: false,
      groups: ["user"],
      rights: ["read", "edit"],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://database.factgrid.de/w/rest.php/oauth2/resource/profile",
      expect.any(Object),
    );
  });

  it("treats an unknown block state as blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ sub: "42", username: "Scholar" })),
    );
    await expect(fetchFactGridProfile("provider-token", configuration())).resolves.toMatchObject({
      blocked: true,
    });
  });
});
