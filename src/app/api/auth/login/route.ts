import { NextRequest, NextResponse } from "next/server";
import * as oauth from "oauth4webapi";

import { getAuthConfiguration, sanitizeReturnPath } from "@/lib/auth/config";
import { buildAuthorizationUrl } from "@/lib/auth/oauth";
import { initiateOAuth1, oauth1AuthorizationUrl } from "@/lib/auth/oauth1";
import { authUnavailable, noStore, privateJson } from "@/lib/auth/responses";
import { getSessionStore, setOAuthTransactionCookie } from "@/lib/auth/session";
import { sealOAuthTransaction } from "@/lib/auth/transaction";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = getAuthConfiguration();
  if (!result.available) return authUnavailable();

  try {
    // Fail before sending the user to FactGrid if sessions cannot be persisted.
    const store = getSessionStore(result.config);
    const returnTo = sanitizeReturnPath(request.nextUrl.searchParams.get("returnTo"));
    if (result.config.oauthVersion === "1.0a") {
      const requestToken = await initiateOAuth1(result.config);
      const transaction = store.createOAuth1Transaction({
        requestToken: requestToken.key,
        requestTokenSecret: requestToken.secret,
        returnTo,
        clientId: result.config.clientId,
        callbackUrl: result.config.callbackUrl,
      });
      const response = NextResponse.redirect(oauth1AuthorizationUrl(result.config, requestToken.key), 302);
      setOAuthTransactionCookie(response, transaction, result.config);
      return noStore(response);
    }
    const state = oauth.generateRandomState();
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const transaction = sealOAuthTransaction(
      { state, codeVerifier, returnTo, issuedAt: Date.now() },
      result.config.sessionSecret,
    );
    const authorizationUrl = await buildAuthorizationUrl(
      result.config,
      state,
      codeVerifier,
    );
    const response = NextResponse.redirect(authorizationUrl, 302);
    setOAuthTransactionCookie(response, transaction, result.config);
    return noStore(response);
  } catch {
    return privateJson(
      {
        error: {
          code: "sign_in_failed",
          message: "FactGrid sign-in could not be started.",
        },
      },
      { status: 503 },
    );
  }
}
