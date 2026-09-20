import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/config";
import { OAUTH_TRANSACTION_COOKIE_NAME } from "@/lib/auth/constants";
import {
  exchangeAuthorizationCode,
  fetchFactGridProfile,
  validateAuthorizationCallback,
} from "@/lib/auth/oauth";
import { authUnavailable, noStore, privateJson } from "@/lib/auth/responses";
import {
  clearOAuthTransactionCookie,
  getSessionStore,
  setSessionCookie,
} from "@/lib/auth/session";
import { openOAuthTransaction } from "@/lib/auth/transaction";

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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = getAuthConfiguration();
  if (!result.available) return authUnavailable();

  const configuredCallback = new URL(result.config.callbackUrl);
  if (
    request.nextUrl.origin !== configuredCallback.origin ||
    request.nextUrl.pathname !== configuredCallback.pathname
  ) {
    return errorResponse(
      400,
      "invalid_callback",
      "The sign-in callback URL did not match this deployment.",
      result,
    );
  }

  const transactionValue = request.cookies.get(OAUTH_TRANSACTION_COOKIE_NAME)?.value;
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
      request.nextUrl,
      transaction.state,
      result.config,
    );
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
