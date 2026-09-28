import { createHmac } from "node:crypto";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET as login } from "@/app/api/auth/login/route";
import { GET as callback } from "@/app/api/auth/callback/route";
import { GET as sessionRoute } from "@/app/api/session/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { getAuthConfiguration } from "./config";
import { FACTGRID_ORIGIN, OAUTH_TRANSACTION_COOKIE_NAME, SESSION_COOKIE_NAME } from "./constants";
import { providerAuthorizationHeader } from "./oauth";
import { getUsableProviderSession } from "./provider-session";
import { getSessionStore } from "./session";

const origin = "https://interface.example";
const consumerKey = "fixture-consumer-key";
const consumerSecret = "fixture-consumer-secret-private";
const requestKey = "fixture-request-key";
const requestSecret = "fixture-request-secret-private";
const accessKey = "fixture-access-key";
const accessSecret = "fixture-access-secret-private";
let sequence = 0;

function config() {
  const result = getAuthConfiguration();
  if (!result.available) throw new Error("Fixture is not configured");
  return result.config;
}

function request(path: string, cookie?: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  const headers = new Headers(init?.headers);
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, origin), {
    ...init,
    headers,
  });
}

function percent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

// Independent RFC 5849 verification: the provider fixture verifies the complete
// header/query/form signature instead of trusting the application's signer.
function verifySignature(input: RequestInfo | URL, init: RequestInit | undefined, secret: string) {
  const url = new URL(input instanceof Request ? input.url : input);
  const authorization = new Headers(init?.headers).get("authorization") ?? "";
  expect(authorization.startsWith("OAuth ")).toBe(true);
  const header = new Map<string, string>();
  for (const field of authorization.slice(6).split(/,\s*/u)) {
    const match = /^([^=]+)="([^"]*)"$/u.exec(field);
    if (!match) throw new Error("Invalid fixture authorization header");
    header.set(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
  }
  const signature = header.get("oauth_signature");
  header.delete("oauth_signature");
  expect(header.get("oauth_consumer_key")).toBe(consumerKey);
  expect(header.get("oauth_signature_method")).toBe("HMAC-SHA1");
  expect(header.get("oauth_nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  const parameters = [
    ...header,
    ...url.searchParams,
    ...(init?.body ? new URLSearchParams(String(init.body)) : []),
  ].map(([key, value]) => [percent(key), percent(value)]);
  parameters.sort(([a, av], [b, bv]) => a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  const normalized = parameters.map(([key, value]) => `${key}=${value}`).join("&");
  const base = `${init?.method ?? "GET"}&${percent(`${url.origin}${url.pathname}`)}&${percent(normalized)}`;
  const expected = createHmac("sha1", `${percent(consumerSecret)}&${percent(secret)}`).update(base).digest("base64");
  expect(signature).toBe(expected);
  expect(authorization).not.toContain(consumerSecret);
  expect(authorization).not.toContain(requestSecret);
  expect(authorization).not.toContain(accessSecret);
  return { url, header };
}

function provider(options: { invalidClaims?: Record<string, unknown>; tokenError?: boolean; initiateError?: boolean; signingSecret?: string } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const title = url.searchParams.get("title");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    if (title === "Special:OAuth/initiate") {
      const { header } = verifySignature(input, init, "");
      expect(header.has("oauth_token")).toBe(false);
      expect(header.has("oauth_callback")).toBe(false);
      expect(url.searchParams.get("oauth_callback")).toBe("oob");
      expect(url.searchParams.get("format")).toBe("json");
      if (options.initiateError) return Response.json({ error: consumerSecret }, { status: 503 });
      return Response.json({ key: requestKey, secret: requestSecret });
    }
    if (title === "Special:OAuth/token") {
      const { header } = verifySignature(input, init, requestSecret);
      expect(header.get("oauth_token")).toBe(requestKey);
      expect(header.has("oauth_verifier")).toBe(false);
      expect(url.searchParams.get("oauth_verifier")).toBe("approved-verifier");
      if (options.tokenError) return Response.json({ error: requestSecret }, { status: 400 });
      return Response.json({ key: accessKey, secret: accessSecret });
    }
    if (title === "Special:OAuth/identify") {
      const { header } = verifySignature(input, init, accessSecret);
      expect(header.get("oauth_token")).toBe(accessKey);
      const now = Math.floor(Date.now() / 1000);
      const jwt = await new SignJWT({
        iss: FACTGRID_ORIGIN, aud: consumerKey, iat: now, exp: now + 120,
        nonce: header.get("oauth_nonce"), sub: "42", username: "Scholar",
        blocked: false, groups: ["user"], rights: ["read", "edit"],
        ...options.invalidClaims,
      }).setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode(options.signingSecret ?? consumerSecret));
      return new Response(jwt, { headers: { "content-type": "application/jwt" } });
    }
    throw new Error("Unexpected external fixture request");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function beginLogin(returnTo = "/tablets/Q42/edit?tab=metadata#preview") {
  const response = await login(request(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`));
  expect(response.status).toBe(302);
  const value = response.cookies.get(OAUTH_TRANSACTION_COOKIE_NAME)?.value;
  expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  const cookie = `${OAUTH_TRANSACTION_COOKIE_NAME}=${value}`;
  return { response, value: value!, cookie };
}

async function completeLogin() {
  const started = await beginLogin();
  const response = await callback(request(`/api/auth/callback?oauth_token=${requestKey}&oauth_verifier=approved-verifier`, started.cookie));
  return { ...started, response };
}

beforeEach(() => {
  sequence += 1;
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("FACTGRID_OAUTH_CALLBACK_URL", `${origin}/api/auth/callback`);
  vi.stubEnv("FACTGRID_OAUTH_VERSION", "1.0a");
  vi.stubEnv("FACTGRID_OAUTH_CONSUMER_KEY", consumerKey);
  vi.stubEnv("FACTGRID_OAUTH_CONSUMER_SECRET", consumerSecret);
  vi.stubEnv("FACTGRID_SESSION_DB_PATH", ":memory:");
  vi.stubEnv("SESSION_SECRET", `oauth1-fixture-session-secret-${String(sequence).padStart(12, "0")}`);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("FACTGRID_EDITING_ENABLED", "false");
});

afterEach(() => {
  getSessionStore(config()).close();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OAuth 1.0a real route handlers", () => {
  it("signs the full handshake, verifies identity, encrypts secrets, and logs out locally", async () => {
    const fetchMock = provider();
    const started = await beginLogin();
    const authorize = new URL(started.response.headers.get("location")!);
    expect(authorize.pathname).toBe("/wiki/Special:OAuth/authorize");
    expect(authorize.searchParams.get("oauth_token")).toBe(requestKey);
    expect(authorize.searchParams.has("code_challenge")).toBe(false);
    expect(started.response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(started.response.headers.get("set-cookie")).toMatch(/Secure/i);
    const transaction = getSessionStore(config()).database.prepare("SELECT * FROM auth_oauth1_transactions").get();
    expect(JSON.stringify(transaction)).not.toContain(requestSecret);
    expect(JSON.stringify(transaction)).not.toContain(started.value);

    const result = await callback(request(`/api/auth/callback?oauth_token=${requestKey}&oauth_verifier=approved-verifier`, started.cookie));
    expect(result.status).toBe(303);
    expect(result.headers.get("location")).toBe(`${origin}/tablets/Q42/edit?tab=metadata#preview`);
    expect(result.headers.get("cache-control")).toContain("no-store");
    const token = result.cookies.get(SESSION_COOKIE_NAME)!.value;
    const cookie = `${SESSION_COOKIE_NAME}=${token}`;
    const stored = getSessionStore(config()).get(token);
    expect(stored).toMatchObject({ oauthVersion: "1.0a", accessToken: accessKey, accessTokenSecret: accessSecret, refreshToken: null });
    expect(JSON.stringify(getSessionStore(config()).getSummary(token))).not.toContain(accessSecret);
    const row = getSessionStore(config()).database.prepare("SELECT * FROM auth_sessions").get();
    expect(JSON.stringify(row)).not.toContain(accessKey);
    expect(JSON.stringify(row)).not.toContain(accessSecret);
    const publicSession = await sessionRoute(request("/api/session", cookie));
    const body = await publicSession.json();
    expect(body).toMatchObject({ authenticated: true, user: { username: "Scholar" }, editingEnabled: false });
    for (const secret of [accessKey, accessSecret, requestSecret, consumerSecret]) expect(JSON.stringify(body)).not.toContain(secret);
    getSessionStore(config()).database.prepare("UPDATE auth_sessions SET access_token_expires_at = 1").run();
    await expect(getUsableProviderSession(token, config())).resolves.toMatchObject({ accessTokenSecret: accessSecret });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const response = await logout(request("/api/auth/logout", cookie, {
      method: "POST", headers: { origin, "x-csrf-token": body.csrfToken },
    }));
    expect(response.status).toBe(204);
    expect(getSessionStore(config()).get(token)).toBeNull();
  });

  it("consumes transactions atomically so even a copied cookie cannot replay", async () => {
    const fetchMock = provider();
    const completed = await completeLogin();
    expect(completed.response.status).toBe(303);
    const replay = await callback(request(`/api/auth/callback?oauth_token=${requestKey}&oauth_verifier=approved-verifier`, completed.cookie));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: { code: "invalid_oauth_transaction" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("allows only one exchange when two callbacks arrive concurrently", async () => {
    const fetchMock = provider();
    const started = await beginLogin();
    const makeRequest = () => request(`/api/auth/callback?oauth_token=${requestKey}&oauth_verifier=approved-verifier`, started.cookie);
    const results = await Promise.all([callback(makeRequest()), callback(makeRequest())]);
    expect(results.map((result) => result.status).sort()).toEqual([303, 400]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    "oauth_token=wrong&oauth_verifier=approved-verifier",
    `oauth_token=${requestKey}`,
    `oauth_token=${requestKey}&oauth_verifier=approved-verifier&oauth_verifier=second`,
    `oauth_token=${requestKey}&oauth_token=${requestKey}&oauth_verifier=approved-verifier`,
    `oauth_token=${requestKey}&oauth_verifier=approved-verifier&error=access_denied`,
  ])("rejects malformed callback %s before requesting access credentials", async (query) => {
    const fetchMock = provider();
    const started = await beginLogin();
    const response = await callback(request(`/api/auth/callback?${query}`, started.cookie));
    expect(response.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("requires the same browser cookie and rejects expired transactions", async () => {
    const fetchMock = provider();
    const started = await beginLogin();
    const query = `/api/auth/callback?oauth_token=${requestKey}&oauth_verifier=approved-verifier`;
    expect((await callback(request(query))).status).toBe(400);
    getSessionStore(config()).database.prepare("UPDATE auth_oauth1_transactions SET expires_at = 0").run();
    expect((await callback(request(query, started.cookie))).status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { iss: "evil.example" }, { iss: "database.factgrid.de" }, { aud: "another-consumer" }, { nonce: "wrong-nonce" },
    { exp: 1 }, { iat: 1 }, { iat: 4_000_000_000 }, { username: "" }, { sub: undefined },
  ])("rejects invalid signed identity claims %j", async (invalidClaims) => {
    provider({ invalidClaims });
    const { response } = await completeLogin();
    expect(response.status).toBe(502);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    const body = JSON.stringify(await response.json());
    for (const secret of [accessKey, accessSecret, requestSecret, consumerSecret]) expect(body).not.toContain(secret);
  });

  it("rejects an identity signature made with the wrong secret", async () => {
    provider({ signingSecret: "a-different-secret" });
    expect((await completeLogin()).response.status).toBe(502);
  });

  it("redacts upstream initiation and exchange failures", async () => {
    provider({ initiateError: true });
    const failed = await login(request("/api/auth/login"));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain(consumerSecret);
    provider({ tokenError: true });
    const { response } = await completeLogin();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(requestSecret);
  });

  it("rejects protocol-mismatched sessions instead of sending OAuth 2 tokens as OAuth 1", async () => {
    const stored = getSessionStore(config()).create({ providerUserId: "99", username: "Old user", accessToken: "old-bearer" });
    await expect(getUsableProviderSession(stored.token, config())).resolves.toBeNull();
    expect(await (await sessionRoute(request("/api/session", `${SESSION_COOKIE_NAME}=${stored.token}`))).json()).toEqual({ authenticated: false });
  });
});

describe("OAuth 1.0a Action API signing", () => {
  it("includes Unicode, form spaces, reserved characters, and repeated parameters exactly once", () => {
    const url = new URL(`${FACTGRID_ORIGIN}/w/api.php?query=two+words&repeat=one&repeat=two`);
    const body = new URLSearchParams([
      ["action", "edit"], ["text", "1. ša₃ 𒀭 + & = %\nsecond line"],
      ["summary", "Tablet: a+b / c?"], ["repeat", "three"], ["blank", ""],
    ]);
    const authorization = providerAuthorizationHeader(config(), {
      oauthVersion: "1.0a", accessToken: accessKey, accessTokenSecret: accessSecret,
    }, "POST", url, body);
    verifySignature(url, { method: "POST", headers: { authorization }, body }, accessSecret);
  });

  it("refuses missing secrets, protocol confusion, and foreign destinations", () => {
    const credentials = { oauthVersion: "1.0a" as const, accessToken: accessKey, accessTokenSecret: accessSecret };
    expect(() => providerAuthorizationHeader(config(), credentials, "GET", "https://evil.example/w/api.php")).toThrow();
    expect(() => providerAuthorizationHeader(config(), { ...credentials, accessTokenSecret: null }, "GET", `${FACTGRID_ORIGIN}/w/api.php`)).toThrow();
    expect(() => providerAuthorizationHeader(config(), { ...credentials, oauthVersion: "2.0" }, "GET", `${FACTGRID_ORIGIN}/w/api.php`)).toThrow();
  });
});
