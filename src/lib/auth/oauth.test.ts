import * as oauth from "oauth4webapi";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAuthConfiguration } from "./config";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchFactGridProfile,
  refreshProviderTokens,
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
        grants: ["basic", "editpage"],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchFactGridProfile("provider-token", configuration())).resolves.toEqual({
      providerUserId: "42",
      username: "Scholar",
      blocked: false,
      groups: ["user"],
      rights: ["read", "edit"],
      grants: ["basic", "editpage"],
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

  it("cancels a chunked multibyte profile response over the byte cap", async () => {
    const chunks = [
      new TextEncoder().encode("é".repeat(32_768)),
      new TextEncoder().encode("é"),
    ];
    const cancel = vi.fn();
    let chunkIndex = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[chunkIndex];
          chunkIndex += 1;
          if (chunk) controller.enqueue(chunk);
        },
        cancel,
      }),
    )));

    await expect(fetchFactGridProfile("provider-token", configuration())).rejects.toThrow(
      "too large",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("OAuth token responses", () => {
  it("rejects and cancels an oversized streamed authorization-code response", async () => {
    const chunks = [
      new Uint8Array(64 * 1024),
      new Uint8Array([1]),
    ];
    const cancel = vi.fn();
    let chunkIndex = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const chunk = chunks[chunkIndex];
          chunkIndex += 1;
          if (chunk) controller.enqueue(chunk);
        },
        cancel,
      }),
      { headers: { "content-type": "application/json" } },
    )));

    const state = oauth.generateRandomState();
    const parameters = validateAuthorizationCallback(
      new URL(`https://interface.example/api/auth/callback?code=fixture-code&state=${state}`),
      state,
      configuration(),
    );
    await expect(exchangeAuthorizationCode(
      parameters,
      oauth.generateRandomCodeVerifier(),
      configuration(),
    )).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["access", "refresh"])("caps an overlong %s token field", async (field) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      access_token: field === "access" ? "a".repeat(4_097) : "access-token",
      refresh_token: field === "refresh" ? "r".repeat(4_097) : "refresh-token",
      token_type: "Bearer",
      expires_in: 3_600,
    })));

    await expect(refreshProviderTokens("current-refresh", configuration())).rejects.toThrow(
      "invalid OAuth token",
    );
  });
});
