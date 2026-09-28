import "server-only";

import OAuth from "oauth-1.0a";
import { createHmac } from "node:crypto";
import { jwtVerify } from "jose";

import type { AuthConfiguration } from "./config";
import {
  FACTGRID_ORIGIN,
  FACTGRID_OAUTH1_INITIATE_URL,
  UPSTREAM_TIMEOUT_MS,
} from "./constants";
import { randomOpaqueToken, safeEqual } from "./crypto";
import type { ProviderTokens } from "./oauth";

export interface OAuth1Token {
  key: string;
  secret: string;
}

/** Sign the exact query and form bytes after standard form decoding. */
export function signOAuth1Request(
  configuration: AuthConfiguration,
  method: string,
  input: string | URL,
  token?: OAuth1Token,
  body?: URLSearchParams,
): { authorization: string; nonce: string } {
  const url = new URL(input);
  if (url.origin !== FACTGRID_ORIGIN || url.username || url.password || url.hash) {
    throw new Error("OAuth credentials can only be sent to FactGrid");
  }
  const parameters: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of [...url.searchParams, ...(body ?? [])]) {
    if (
      ["__proto__", "constructor", "prototype"].includes(key) ||
      (key.startsWith("oauth_") && !["oauth_callback", "oauth_verifier"].includes(key))
    ) {
      throw new Error("Invalid OAuth request parameter");
    }
    const existing = parameters[key];
    parameters[key] = existing === undefined
      ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  // The library's query decoder does not decode '+' as a form space. Supply
  // URLSearchParams-decoded data once and omit the query from its signing URL.
  url.search = "";
  const signer = new OAuth({
    consumer: { key: configuration.clientId, secret: configuration.clientSecret },
    signature_method: "HMAC-SHA1",
    hash_function: (base, key) => createHmac("sha1", key).update(base).digest("base64"),
  });
  signer.getNonce = randomOpaqueToken;
  const signed = signer.authorize({ url: url.href, method, data: parameters }, token);
  // oauth_callback/verifier already travel in the query. Do not duplicate them
  // in the Authorization header when the library merges parameters to sign.
  const header: OAuth.Authorization = {
    oauth_consumer_key: signed.oauth_consumer_key,
    oauth_nonce: signed.oauth_nonce,
    oauth_signature_method: signed.oauth_signature_method,
    oauth_timestamp: signed.oauth_timestamp,
    oauth_version: signed.oauth_version,
    oauth_signature: signed.oauth_signature,
    ...(signed.oauth_token ? { oauth_token: signed.oauth_token } : {}),
  };
  return { authorization: signer.toHeader(header).Authorization, nonce: signed.oauth_nonce };
}

async function signedGet(
  url: URL,
  configuration: AuthConfiguration,
  token?: OAuth1Token,
): Promise<{ body: string; nonce: string }> {
  const signed = signOAuth1Request(configuration, "GET", url, token);
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json, application/jwt", authorization: signed.authorization },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("FactGrid OAuth request failed");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
    throw new Error("FactGrid OAuth response is too large");
  }
  const body = await response.text();
  if (body.length > 64 * 1024) throw new Error("FactGrid OAuth response is too large");
  return { body, nonce: signed.nonce };
}

function parseToken(body: string): OAuth1Token {
  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid OAuth token response");
  const result = parsed as Record<string, unknown>;
  if (
    result.error ||
    typeof result.key !== "string" || !result.key || result.key.length > 4096 ||
    typeof result.secret !== "string" || !result.secret || result.secret.length > 4096
  ) throw new Error("Invalid OAuth token response");
  return { key: result.key, secret: result.secret };
}

export async function initiateOAuth1(configuration: AuthConfiguration): Promise<OAuth1Token> {
  const url = new URL(FACTGRID_OAUTH1_INITIATE_URL);
  url.searchParams.set("format", "json");
  // MediaWiki requires oob for a consumer with an exact registered callback.
  // It still redirects to that registered URL after the user authorizes.
  url.searchParams.set("oauth_callback", "oob");
  return parseToken((await signedGet(url, configuration)).body);
}

export function oauth1AuthorizationUrl(
  configuration: AuthConfiguration,
  requestToken: string,
): URL {
  const url = new URL(configuration.oauth.authorizationEndpoint);
  url.searchParams.set("oauth_consumer_key", configuration.clientId);
  url.searchParams.set("oauth_token", requestToken);
  return url;
}

export async function exchangeOAuth1Token(
  token: OAuth1Token,
  verifier: string,
  configuration: AuthConfiguration,
): Promise<ProviderTokens> {
  const url = new URL(configuration.oauth.tokenEndpoint);
  url.searchParams.set("format", "json");
  url.searchParams.set("oauth_verifier", verifier);
  const access = parseToken((await signedGet(url, configuration, token)).body);
  return {
    accessToken: access.key,
    accessTokenSecret: access.secret,
    refreshToken: null,
    accessTokenExpiresAt: null,
  };
}

export async function identifyOAuth1(
  token: OAuth1Token,
  configuration: AuthConfiguration,
): Promise<Record<string, unknown>> {
  const { body, nonce } = await signedGet(
    new URL(configuration.oauth.profileEndpoint), configuration, token,
  );
  const { payload } = await jwtVerify(body.trim(), new TextEncoder().encode(configuration.clientSecret), {
    algorithms: ["HS256"],
    // Extension:OAuth UserStatementProvider emits MediaWiki CanonicalServer,
    // which includes the scheme, despite older prose saying "domain name".
    issuer: FACTGRID_ORIGIN,
    audience: configuration.clientId,
    requiredClaims: ["iat", "exp", "nonce", "sub"],
    maxTokenAge: 300,
  });
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(payload.iat) || payload.iat! > now ||
    !Number.isSafeInteger(payload.exp) || payload.exp! <= now ||
    typeof payload.nonce !== "string" || !safeEqual(payload.nonce, nonce)
  ) throw new Error("Invalid FactGrid identity assertion");
  return payload;
}
