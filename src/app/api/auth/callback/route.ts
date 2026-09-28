import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/config";
import { OAUTH_TRANSACTION_COOKIE_NAME } from "@/lib/auth/constants";
import {
  exchangeAuthorizationCode,
  fetchFactGridProfile,
  validateAuthorizationCallback,
} from "@/lib/auth/oauth";
import { exchangeOAuth1Token } from "@/lib/auth/oauth1";
import { safeEqual } from "@/lib/auth/crypto";
import { authUnavailable, noStore, privateJson } from "@/lib/auth/responses";
import {
  clearOAuthTransactionCookie,
  getSessionStore,
  setSessionCookie,
} from "@/lib/auth/session";
import { openOAuthTransaction } from "@/lib/auth/transaction";
import type { OAuth1Transaction } from "@/lib/auth/session-store";

export const runtime = "nodejs";

function errorResponse(
  status: number,
  code: string,
  message: string,
  configuration: ReturnType<typeof getAuthConfiguration> & { available: true },
): NextResponse {
  const response = privateJson({ error: { code, message } }, { status });
  clearOAuthTransactionCookie(response, configuration.config);
  return response;
}

function forwardedOrigin(request: NextRequest): string | null {
  const protocol = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host");
  const hostPattern = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/u;
  if (!protocol || !host) return null;

  // A trusted proxy must overwrite both values. Reject comma-joined chains and
  // any syntax that could make the authority ambiguous before URL parsing.
  if (
    (protocol !== "http" && protocol !== "https") ||
    protocol.includes(",") ||
    host.includes(",") ||
    /[\s\\/@?#]/u.test(host) ||
    !hostPattern.test(host)
  ) {
    return null;
  }

  try {
    const origin = new URL(`${protocol}://${host}`);
    if (
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    ) {
      return null;
    }
    return origin.origin;
  } catch {
    return null;
  }
}

function isExpectedCallback(request: NextRequest, configuredCallback: URL): boolean {
  const requestUrl = new URL(request.url);
  if (requestUrl.pathname !== configuredCallback.pathname) return false;
  if (requestUrl.origin === configuredCallback.origin) return true;
  return forwardedOrigin(request) === configuredCallback.origin;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = getAuthConfiguration();
  if (!result.available) return authUnavailable();

  const configuredCallback = new URL(result.config.callbackUrl);
  if (!isExpectedCallback(request, configuredCallback)) {
    return errorResponse(
      400,
      "invalid_callback",
      "The sign-in callback URL did not match this deployment.",
      result,
    );
  }

  const transactionValue = request.cookies.get(OAUTH_TRANSACTION_COOKIE_NAME)?.value;
  if (result.config.oauthVersion === "1.0a") {
    let transaction: OAuth1Transaction | null;
    try {
      transaction = getSessionStore(result.config).consumeOAuth1Transaction(transactionValue);
    } catch {
      return errorResponse(503, "session_unavailable", "The session service is temporarily unavailable.", result);
    }
    if (!transaction || transaction.clientId !== result.config.clientId || transaction.callbackUrl !== result.config.callbackUrl) {
      return errorResponse(400, "invalid_oauth_transaction", "This sign-in attempt is missing, invalid, or expired. Please start again.", result);
    }
    const query = new URL(request.url).searchParams;
    const token = query.get("oauth_token");
    const verifier = query.get("oauth_verifier");
    if (
      query.has("error") || query.has("denied") ||
      query.getAll("oauth_token").length !== 1 || query.getAll("oauth_verifier").length !== 1 ||
      !token || !safeEqual(token, transaction.requestToken) ||
      !verifier || verifier.length > 4096 || /[\u0000-\u0020\u007f]/u.test(verifier)
    ) {
      return errorResponse(400, "invalid_oauth_response", "FactGrid did not return a valid sign-in response. Please start again.", result);
    }
    let tokens: Awaited<ReturnType<typeof exchangeOAuth1Token>>;
    let profile: Awaited<ReturnType<typeof fetchFactGridProfile>>;
    try {
      tokens = await exchangeOAuth1Token({ key: transaction.requestToken, secret: transaction.requestTokenSecret }, verifier, result.config);
      profile = await fetchFactGridProfile(tokens.accessToken, result.config, tokens.accessTokenSecret);
    } catch {
      return errorResponse(502, "factgrid_sign_in_failed", "FactGrid sign-in could not be completed. Please try again.", result);
    }
    try {
      const session = getSessionStore(result.config).create({
        oauthVersion: "1.0a",
        providerUserId: profile.providerUserId,
        username: profile.username,
        ...tokens,
      });
      const response = NextResponse.redirect(new URL(transaction.returnTo, result.config.appOrigin), 303);
      clearOAuthTransactionCookie(response, result.config);
      setSessionCookie(response, session.token, session.expiresAt, result.config);
      return noStore(response);
    } catch {
      return errorResponse(503, "session_unavailable", "Sign-in succeeded, but a local session could not be created. Please try again.", result);
    }
  }
  const transaction = transactionValue
    ? openOAuthTransaction(transactionValue, result.config.sessionSecret)
    : null;
  if (!transaction) {
    return errorResponse(
      400,
      "invalid_oauth_transaction",
      "This sign-in attempt is missing, invalid, or expired. Please start again.",
      result,
    );
  }

  let parameters: URLSearchParams;
  try {
    parameters = validateAuthorizationCallback(
      new URL(request.url),
      transaction.state,
      result.config,
    );
    if (!parameters.get("code")) {
      throw new Error("The OAuth callback did not include an authorization code");
    }
  } catch {
    return errorResponse(
      400,
      "invalid_oauth_response",
      "FactGrid did not return a valid sign-in response. Please start again.",
      result,
    );
  }

  let tokens: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
  let profile: Awaited<ReturnType<typeof fetchFactGridProfile>>;
  try {
    tokens = await exchangeAuthorizationCode(
      parameters,
      transaction.codeVerifier,
      result.config,
    );
    profile = await fetchFactGridProfile(tokens.accessToken, result.config);
  } catch {
    return errorResponse(
      502,
      "factgrid_sign_in_failed",
      "FactGrid sign-in could not be completed. Please try again.",
      result,
    );
  }

  try {
    const session = getSessionStore(result.config).create({
      providerUserId: profile.providerUserId,
      username: profile.username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    });

    const destination = new URL(transaction.returnTo, result.config.appOrigin);
    const response = NextResponse.redirect(destination, 303);
    clearOAuthTransactionCookie(response, result.config);
    setSessionCookie(response, session.token, session.expiresAt, result.config);
    return noStore(response);
  } catch {
    return errorResponse(
      503,
      "session_unavailable",
      "Sign-in succeeded, but a local session could not be created. Please try again.",
      result,
    );
  }
}
