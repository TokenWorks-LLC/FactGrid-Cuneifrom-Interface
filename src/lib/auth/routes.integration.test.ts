import * as oauth from "oauth4webapi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

import { GET as callback } from "@/app/api/auth/callback/route";
import { GET as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/session/route";
import { PUT as updateEdition } from "@/app/api/tablets/[qid]/editions/[editionId]/route";
import { getAuthConfiguration } from "./config";
import {
  OAUTH_TRANSACTION_COOKIE_NAME,
  OAUTH_TRANSACTION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
} from "./constants";
import { getUsableProviderSession } from "./provider-session";
import { getSessionStore } from "./session";
import { openOAuthTransaction, sealOAuthTransaction } from "./transaction";

const APP_ORIGIN = "https://interface.example";
const CALLBACK_URL = `${APP_ORIGIN}/api/auth/callback`;
const CLIENT_ID = "fixture-client-id";
const CLIENT_SECRET = "fixture-client-secret-never-public";
let configurationSequence = 0;

function request(
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
): NextRequest {
  return new NextRequest(new URL(path, APP_ORIGIN), init);
}

function cookieHeader(name: string, value: string): string {
  return `${name}=${value}`;
}

function setConfiguredEnvironment(options?: {
  editingEnabled?: boolean;
  allowedEditors?: string;
}): void {
  configurationSequence += 1;
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  vi.stubEnv("FACTGRID_OAUTH_CALLBACK_URL", CALLBACK_URL);
  vi.stubEnv("FACTGRID_OAUTH_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("FACTGRID_OAUTH_CLIENT_SECRET", CLIENT_SECRET);
  vi.stubEnv("FACTGRID_SESSION_DB_PATH", ":memory:");
  vi.stubEnv(
    "SESSION_SECRET",
    `fixture-session-secret-${configurationSequence.toString().padStart(12, "0")}`,
  );
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(
    "FACTGRID_EDITING_ENABLED",
    options?.editingEnabled ? "true" : "false",
  );
  vi.stubEnv("FACTGRID_ALLOWED_EDITORS", options?.allowedEditors ?? "");
}

function configured() {
  const result = getAuthConfiguration();
  if (!result.available) throw new Error("The integration fixture is not configured");
  return result.config;
}

function transactionCookie(response: Response): string {
  const value = (response as Awaited<ReturnType<typeof login>>).cookies.get(
    OAUTH_TRANSACTION_COOKIE_NAME,
  )?.value;
  if (!value) throw new Error("The login route did not set a transaction cookie");
  return value;
}

function sessionCookie(response: Response): string {
  const value = (response as Awaited<ReturnType<typeof callback>>).cookies.get(
    SESSION_COOKIE_NAME,
  )?.value;
  if (!value) throw new Error("The callback route did not set a session cookie");
  return value;
}

interface ProviderFixtureOptions {
  tokenStatus?: number;
  profileStatus?: number;
  profile?: Record<string, unknown>;
  onTokenRequest?: (body: URLSearchParams, url: URL) => void;
}

function installProviderFixture(options: ProviderFixtureOptions = {}) {
  const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      calls.push({ url, init });

      if (url.pathname.endsWith("/oauth2/access_token")) {
        const body =
          init?.body instanceof URLSearchParams
            ? init.body
            : new URLSearchParams(String(init?.body ?? ""));
        options.onTokenRequest?.(body, url);
        if (options.tokenStatus && options.tokenStatus !== 200) {
          return Response.json(
            { error: "invalid_grant", error_description: "fixture rejection" },
            { status: options.tokenStatus },
          );
        }
        return Response.json({
          access_token: "fixture-provider-access-token",
          refresh_token: "fixture-provider-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }

      if (url.pathname.endsWith("/oauth2/resource/profile")) {
        if (options.profileStatus && options.profileStatus !== 200) {
          return Response.json(
            { error: "fixture_profile_failure" },
            { status: options.profileStatus },
          );
        }
        return Response.json(
          options.profile ?? {
            sub: "42",
            username: "Scholar",
            blocked: false,
            groups: ["user"],
            rights: ["read", "edit"],
          },
        );
      }

      throw new Error(`Unexpected external request: ${url.href}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

async function beginLogin(returnTo = "/tablets/Q499899?view=edition#transcript") {
  const response = await login(
    request(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`),
  );
  const sealed = transactionCookie(response);
  const transaction = openOAuthTransaction(
    sealed,
    configured().sessionSecret,
  );
  if (!transaction) throw new Error("The transaction cookie could not be opened");
  return { response, sealed, transaction };
}

async function completeLogin(returnTo?: string) {
  const started = await beginLogin(returnTo);
  installProviderFixture({
    onTokenRequest(body, url) {
      expect(url.search).toBe("");
      expect(body.get("code")).toBe("fixture-code");
      expect(body.get("code_verifier")).toBe(started.transaction.codeVerifier);
      expect(body.get("client_secret")).toBe(CLIENT_SECRET);
    },
  });
  const callbackRequest = request(
      `/api/auth/callback?code=fixture-code&state=${encodeURIComponent(started.transaction.state)}`,
      {
        headers: {
          cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, started.sealed),
        },
      },
    );
  const response = await callback(callbackRequest);
  if (response.status !== 303) {
    throw new Error(`Callback failed: ${response.status} ${await response.clone().text()}`);
  }
  return { ...started, callbackResponse: response, sessionToken: sessionCookie(response) };
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toContain("private");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toContain("Cookie");
}

beforeEach(() => {
  setConfiguredEnvironment();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authentication route integration", () => {
  it("returns a private, sanitized unavailable response when OAuth is not configured", async () => {
    vi.stubEnv("FACTGRID_OAUTH_CLIENT_ID", "");

    const response = await login(request("/api/auth/login"));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(serialized).toContain("auth_unavailable");
    expect(serialized).not.toContain("FACTGRID_OAUTH_CLIENT_ID");
    expect(serialized).not.toContain(CLIENT_SECRET);
    expect(response.headers.get("location")).toBeNull();
    expectPrivateNoStore(response);
  });

  it("starts the configured flow with state, S256 PKCE, secure cookies, and a safe return path", async () => {
    const { response, sealed, transaction } = await beginLogin();
    const destination = new URL(response.headers.get("location")!);
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(302);
    expect(destination.origin).toBe("https://database.factgrid.de");
    expect(destination.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(destination.searchParams.get("redirect_uri")).toBe(CALLBACK_URL);
    expect(destination.searchParams.get("state")).toBe(transaction.state);
    expect(destination.searchParams.get("code_challenge_method")).toBe("S256");
    expect(destination.searchParams.get("code_challenge")).toBe(
      await oauth.calculatePKCECodeChallenge(transaction.codeVerifier),
    );
    expect(transaction.returnTo).toBe("/tablets/Q499899?view=edition#transcript");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(destination.href).not.toContain(CLIENT_SECRET);
    expect(destination.href).not.toContain(transaction.codeVerifier);
    expect(sealed).not.toContain(transaction.state);
    expect(sealed).not.toContain(transaction.codeVerifier);
    expectPrivateNoStore(response);
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "javascript:alert(1)",
  ])("rejects the external or ambiguous return destination %s", async (returnTo) => {
    const { transaction } = await beginLogin(returnTo);
    expect(transaction.returnTo).toBe("/");
  });

  it("completes callback, creates an opaque session, and exposes no provider credential", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { callbackResponse, sessionToken } = await completeLogin();
    const callbackHeaders = [...callbackResponse.headers.entries()].join("\n");

    expect(callbackResponse.status).toBe(303);
    expect(callbackResponse.headers.get("location")).toBe(
      `${APP_ORIGIN}/tablets/Q499899?view=edition#transcript`,
    );
    expect(callbackResponse.cookies.get(OAUTH_TRANSACTION_COOKIE_NAME)?.value).toBe("");
    expect(sessionToken).not.toContain("fixture-provider-access-token");
    expect(callbackHeaders).not.toContain("fixture-provider-access-token");
    expect(callbackHeaders).not.toContain("fixture-provider-refresh-token");
    expect(callbackHeaders).not.toContain(CLIENT_SECRET);
    expect(callbackHeaders).toMatch(/HttpOnly/i);
    expect(callbackHeaders).toMatch(/Secure/i);
    expectPrivateNoStore(callbackResponse);

    const response = await session(
      request("/api/session", {
        headers: { cookie: cookieHeader(SESSION_COOKIE_NAME, sessionToken) },
      }),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      authenticated: true,
      user: { id: "42", username: "Scholar" },
      editingEnabled: false,
      editorApproved: false,
    });
    expect(serialized).not.toContain("fixture-provider-access-token");
    expect(serialized).not.toContain("fixture-provider-refresh-token");
    expect(serialized).not.toContain(CLIENT_SECRET);
    expectPrivateNoStore(response);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("accepts an exact configured callback reconstructed by a trusted TLS proxy", async () => {
    const started = await beginLogin("/browse");
    installProviderFixture({
      onTokenRequest(body) {
        expect(body.get("code_verifier")).toBe(started.transaction.codeVerifier);
      },
    });
    const response = await callback(
      new NextRequest(
        `http://interface.example/api/auth/callback?code=fixture-code&state=${started.transaction.state}`,
        {
          headers: {
            cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, started.sealed),
            "x-forwarded-host": "interface.example",
            "x-forwarded-proto": "https",
          },
        },
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP_ORIGIN}/browse`);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it.each([
    ["missing forwarded host", { "x-forwarded-proto": "https" }],
    ["missing forwarded protocol", { "x-forwarded-host": "interface.example" }],
    [
      "chained forwarded protocol",
      {
        "x-forwarded-host": "interface.example",
        "x-forwarded-proto": "https,http",
      },
    ],
    [
      "chained forwarded host",
      {
        "x-forwarded-host": "interface.example,evil.example",
        "x-forwarded-proto": "https",
      },
    ],
    [
      "mismatched forwarded protocol",
      { "x-forwarded-host": "interface.example", "x-forwarded-proto": "http" },
    ],
    [
      "mismatched forwarded host",
      { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    ],
    [
      "malformed forwarded host",
      { "x-forwarded-host": "interface.example/path", "x-forwarded-proto": "https" },
    ],
    [
      "malformed forwarded port",
      { "x-forwarded-host": "interface.example:99999", "x-forwarded-proto": "https" },
    ],
  ])("rejects a backend callback with %s", async (_label, forwardedHeaders) => {
    const started = await beginLogin();
    const fixture = installProviderFixture();
    const response = await callback(
      new NextRequest(
        `http://interface.example/api/auth/callback?code=fixture-code&state=${started.transaction.state}`,
        {
          headers: {
            cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, started.sealed),
            ...forwardedHeaders,
          },
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_callback" } });
    expect(response.cookies.get(OAUTH_TRANSACTION_COOKIE_NAME)?.value).toBe("");
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a forwarded callback whose backend path is not exact", async () => {
    const started = await beginLogin();
    const fixture = installProviderFixture();
    const response = await callback(
      new NextRequest(
        `http://interface.example/api/auth/not-callback?code=fixture-code&state=${started.transaction.state}`,
        {
          headers: {
            cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, started.sealed),
            "x-forwarded-host": "interface.example",
            "x-forwarded-proto": "https",
          },
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_callback" } });
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", null],
    ["invalid", "not-a-valid-sealed-value"],
  ])("rejects a %s transaction before provider access", async (_label, value) => {
    const fixture = installProviderFixture();
    const response = await callback(
      request("/api/auth/callback?code=fixture-code&state=fixture-state", {
        headers: value
          ? { cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, value) }
          : undefined,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_oauth_transaction" },
    });
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    expect(response.cookies.get(OAUTH_TRANSACTION_COOKIE_NAME)?.value).toBe("");
  });

  it("rejects an expired transaction before provider access", async () => {
    const fixture = installProviderFixture();
    const value = sealOAuthTransaction(
      {
        state: "s".repeat(43),
        codeVerifier: "v".repeat(43),
        returnTo: "/",
        issuedAt: Date.now() - (OAUTH_TRANSACTION_TTL_SECONDS + 1) * 1000,
      },
      configured().sessionSecret,
    );
    const response = await callback(
      request("/api/auth/callback?code=fixture-code&state=fixture-state", {
        headers: { cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, value) },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_oauth_transaction" },
    });
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    expect(response.cookies.get(OAUTH_TRANSACTION_COOKIE_NAME)?.value).toBe("");
  });

  it.each([
    ["state mismatch", (state: string) => `?code=fixture-code&state=wrong-${state}`],
    ["missing code", (state: string) => `?state=${state}`],
    ["provider denial", (state: string) => `?error=access_denied&state=${state}`],
  ])("rejects %s without creating a session", async (_label, query) => {
    const started = await beginLogin();
    const fixture = installProviderFixture();
    const response = await callback(
      request(`/api/auth/callback${query(started.transaction.state)}`, {
        headers: {
          cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, started.sealed),
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "invalid_oauth_response" },
    });
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for token, profile, and profile-identity failures", async () => {
    for (const provider of [
      { tokenStatus: 400 },
      { profileStatus: 503 },
      { profile: { sub: "42", username: "", blocked: false } },
    ]) {
      vi.unstubAllGlobals();
      const started = await beginLogin();
      installProviderFixture(provider);
      const response = await callback(
        request(
          `/api/auth/callback?code=fixture-code&state=${started.transaction.state}`,
          {
            headers: {
              cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, started.sealed),
            },
          },
        ),
      );
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(502);
      expect(serialized).toContain("factgrid_sign_in_failed");
      expect(serialized).not.toContain("fixture-provider-access-token");
      expect(serialized).not.toContain(CLIENT_SECRET);
      expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
      expect(response.cookies.get(OAUTH_TRANSACTION_COOKIE_NAME)?.value).toBe("");
    }
  });

  it("treats a repeated authorization code as a provider-rejected replay", async () => {
    const started = await beginLogin();
    let tokenRequests = 0;
    const fixture = installProviderFixture();
    fixture.fetchMock.mockImplementation(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = new URL(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (url.pathname.endsWith("/oauth2/access_token")) {
          tokenRequests += 1;
          if (tokenRequests > 1) {
            return Response.json({ error: "invalid_grant" }, { status: 400 });
          }
          return Response.json({
            access_token: "fixture-provider-access-token",
            token_type: "Bearer",
          });
        }
        return Response.json({
          sub: "42",
          username: "Scholar",
          blocked: false,
          groups: ["user"],
          rights: ["read"],
        });
      },
    );
    const callbackRequest = () =>
      request(
        `/api/auth/callback?code=one-time-code&state=${started.transaction.state}`,
        {
          headers: {
            cookie: cookieHeader(OAUTH_TRANSACTION_COOKIE_NAME, started.sealed),
          },
        },
      );

    const first = await callback(callbackRequest());
    const replay = await callback(callbackRequest());

    expect(first.status).toBe(303);
    expect(replay.status).toBe(502);
    expect(await replay.json()).toMatchObject({
      error: { code: "factgrid_sign_in_failed" },
    });
    expect(replay.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("logs out with same-origin CSRF protection and invalidates the SQLite session", async () => {
    const { sessionToken } = await completeLogin("/browse");
    const beforeLogout = await session(
      request("/api/session", {
        headers: { cookie: cookieHeader(SESSION_COOKIE_NAME, sessionToken) },
      }),
    );
    const beforeBody = await beforeLogout.json();

    const response = await logout(
      request("/api/auth/logout", {
        method: "POST",
        headers: {
          cookie: cookieHeader(SESSION_COOKIE_NAME, sessionToken),
          origin: APP_ORIGIN,
          "x-csrf-token": beforeBody.csrfToken,
        },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("");
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expectPrivateNoStore(response);

    const afterLogout = await session(
      request("/api/session", {
        headers: { cookie: cookieHeader(SESSION_COOKIE_NAME, sessionToken) },
      }),
    );
    expect(await afterLogout.json()).toEqual({ authenticated: false });
  });

  it("clears the browser credential when OAuth configuration becomes unavailable", async () => {
    const { sessionToken } = await completeLogin("/browse");
    vi.stubEnv("FACTGRID_OAUTH_CLIENT_ID", "");

    const response = await logout(
      request("/api/auth/logout", {
        method: "POST",
        headers: { cookie: cookieHeader(SESSION_COOKIE_NAME, sessionToken) },
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "auth_unavailable" },
    });
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe("");
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
    expectPrivateNoStore(response);
  });

  it("keeps an authenticated but unapproved account denied by the real edit route", async () => {
    setConfiguredEnvironment({ editingEnabled: true, allowedEditors: "AnotherEditor" });
    const { sessionToken } = await completeLogin();
    const sessionResponse = await session(
      request("/api/session", {
        headers: { cookie: cookieHeader(SESSION_COOKIE_NAME, sessionToken) },
      }),
    );
    const sessionBody = await sessionResponse.json();
    expect(sessionBody).toMatchObject({
      authenticated: true,
      editingEnabled: true,
      editorApproved: false,
    });

    const response = await updateEdition(
      request("/api/tablets/Q42/editions/Q42%24A1-B2", {
        method: "PUT",
        headers: {
          cookie: cookieHeader(SESSION_COOKIE_NAME, sessionToken),
          origin: APP_ORIGIN,
          "content-type": "application/json",
          "x-csrf-token": sessionBody.csrfToken,
        },
        body: JSON.stringify({ baseRevision: 100, text: "draft", summary: "" }),
      }),
      { params: Promise.resolve({ qid: "Q42", editionId: "Q42$A1-B2" }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "editor_not_authorized" },
    });
  });
});

describe("provider refresh with real isolated session storage", () => {
  it("persists a successful refresh and fails closed when the provider rejects it", async () => {
    const config = configured();
    const now = Date.now();
    const store = getSessionStore(config);
    const created = store.create(
      {
        providerUserId: "42",
        username: "Scholar",
        accessToken: "expired-provider-access",
        refreshToken: "fixture-refresh-token",
        accessTokenExpiresAt: now + 1_000,
      },
      now,
    );
    installProviderFixture();

    await expect(
      getUsableProviderSession(created.token, config, now),
    ).resolves.toMatchObject({
      accessToken: "fixture-provider-access-token",
      refreshToken: "fixture-provider-refresh-token",
    });
    expect(store.get(created.token, now)?.accessToken).toBe(
      "fixture-provider-access-token",
    );

    const second = store.create(
      {
        providerUserId: "43",
        username: "AnotherScholar",
        accessToken: "expired-second-access",
        refreshToken: "fixture-second-refresh",
        accessTokenExpiresAt: now + 1_000,
      },
      now,
    );
    vi.unstubAllGlobals();
    installProviderFixture({ tokenStatus: 400 });
    await expect(
      getUsableProviderSession(second.token, config, now),
    ).resolves.toBeNull();
    expect(store.get(second.token, now)?.accessToken).toBe("expired-second-access");
  });
});
