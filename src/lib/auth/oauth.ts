import * as oauth from "oauth4webapi";

import type { AuthConfiguration } from "./config";
import { UPSTREAM_TIMEOUT_MS } from "./constants";

export interface FactGridProfile {
  providerUserId: string;
  username: string;
  blocked: boolean;
  groups: string[];
  rights: string[];
}

export interface ProviderTokens {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresAt: number | null;
}

function authorizationServer(
  configuration: AuthConfiguration,
): oauth.AuthorizationServer {
  return {
    issuer: configuration.oauth.issuer,
    authorization_endpoint: configuration.oauth.authorizationEndpoint,
    token_endpoint: configuration.oauth.tokenEndpoint,
    userinfo_endpoint: configuration.oauth.profileEndpoint,
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  };
}

function client(configuration: AuthConfiguration): oauth.Client {
  return { client_id: configuration.clientId };
}

const timeoutFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

function oauthRequestOptions(): oauth.HttpRequestOptions<"POST", URLSearchParams> {
  return { [oauth.customFetch]: timeoutFetch };
}

function tokenExpiry(expiresIn: number | undefined, now: number): number | null {
  if (expiresIn === undefined) return null;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  const expiry = now + Math.floor(expiresIn * 1000);
  return Number.isSafeInteger(expiry) ? expiry : null;
}

function providerTokens(
  response: oauth.TokenEndpointResponse,
  now = Date.now(),
): ProviderTokens {
  if (response.token_type !== "bearer") {
    throw new Error("Unsupported provider token type");
  }
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    accessTokenExpiresAt: tokenExpiry(response.expires_in, now),
  };
}

export async function buildAuthorizationUrl(
  configuration: AuthConfiguration,
  state: string,
  codeVerifier: string,
): Promise<URL> {
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const url = new URL(configuration.oauth.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", configuration.clientId);
  url.searchParams.set("redirect_uri", configuration.callbackUrl);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export function validateAuthorizationCallback(
  callbackUrl: URL,
  expectedState: string,
  configuration: AuthConfiguration,
): URLSearchParams {
  return oauth.validateAuthResponse(
    authorizationServer(configuration),
    client(configuration),
    callbackUrl,
    expectedState,
  );
}

export async function exchangeAuthorizationCode(
  parameters: URLSearchParams,
  codeVerifier: string,
  configuration: AuthConfiguration,
  now = Date.now(),
): Promise<ProviderTokens> {
  const as = authorizationServer(configuration);
  const oauthClient = client(configuration);
  const response = await oauth.authorizationCodeGrantRequest(
    as,
    oauthClient,
    oauth.ClientSecretPost(configuration.clientSecret),
    parameters,
    configuration.callbackUrl,
    codeVerifier,
    oauthRequestOptions(),
  );
  const result = await oauth.processAuthorizationCodeResponse(
    as,
    oauthClient,
    response,
  );
  return providerTokens(result, now);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export async function fetchFactGridProfile(
  accessToken: string,
  configuration: AuthConfiguration,
): Promise<FactGridProfile> {
  const response = await timeoutFetch(configuration.oauth.profileEndpoint, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) throw new Error("FactGrid profile request failed");

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) {
    throw new Error("FactGrid profile response is too large");
  }
  const body = await response.text();
  if (body.length > 64 * 1024) throw new Error("FactGrid profile response is too large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("FactGrid profile response is invalid");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("FactGrid profile response is invalid");
  }

  const profile = parsed as Record<string, unknown>;
  const providerUserId =
    typeof profile.sub === "string"
      ? profile.sub
      : typeof profile.sub === "number" && Number.isSafeInteger(profile.sub)
        ? String(profile.sub)
        : "";
  const username = typeof profile.username === "string" ? profile.username.trim() : "";
  if (!providerUserId || !username || providerUserId.length > 255 || username.length > 255) {
    throw new Error("FactGrid profile response is invalid");
  }

  return {
    providerUserId,
    username,
    // Unknown or malformed block state is treated as blocked by downstream policy.
    blocked: profile.blocked !== false,
    groups: stringArray(profile.groups),
    rights: stringArray(profile.rights),
  };
}

export async function refreshProviderTokens(
  refreshToken: string,
  configuration: AuthConfiguration,
  now = Date.now(),
): Promise<ProviderTokens> {
  const as = authorizationServer(configuration);
  const oauthClient = client(configuration);
  const response = await oauth.refreshTokenGrantRequest(
    as,
    oauthClient,
    oauth.ClientSecretPost(configuration.clientSecret),
    refreshToken,
    oauthRequestOptions(),
  );
  const result = await oauth.processRefreshTokenResponse(as, oauthClient, response);
  return providerTokens(result, now);
}
