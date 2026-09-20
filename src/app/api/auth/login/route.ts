import { NextRequest, NextResponse } from "next/server";
import * as oauth from "oauth4webapi";

import { getAuthConfiguration, sanitizeReturnPath } from "@/lib/auth/config";
import { buildAuthorizationUrl } from "@/lib/auth/oauth";
import { authUnavailable, noStore, privateJson } from "@/lib/auth/responses";
import { getSessionStore, setOAuthTransactionCookie } from "@/lib/auth/session";
import { sealOAuthTransaction } from "@/lib/auth/transaction";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = getAuthConfiguration();
  if (!result.available) return authUnavailable();

  try {
    // Fail before sending the user to FactGrid if sessions cannot be persisted.
    getSessionStore(result.config);
    const state = oauth.generateRandomState();
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const returnTo = sanitizeReturnPath(request.nextUrl.searchParams.get("returnTo"));
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
