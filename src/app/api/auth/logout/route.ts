import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/config";
import { CSRF_HEADER_NAME } from "@/lib/auth/constants";
import { hasValidCsrfToken, isSameOriginRequest } from "@/lib/auth/policy";
import { privateJson } from "@/lib/auth/responses";
import {
  clearSessionCookie,
  getSessionStore,
  readSessionToken,
} from "@/lib/auth/session";
import type { SessionStore, SessionSummary } from "@/lib/auth/session-store";

export const runtime = "nodejs";

function sessionRevocationUnavailable(
  configuration: Parameters<typeof clearSessionCookie>[1],
): NextResponse {
  const response = privateJson(
    {
      signedOut: true,
      serverSessionRevoked: false,
      warning:
        "The browser credential was cleared, but the server session could not be revoked. Revoke the connected application in FactGrid if needed.",
      error: {
        code: "session_unavailable",
        message:
          "The browser credential was cleared, but the server session could not be revoked. Revoke the connected application in FactGrid if needed.",
      },
    },
    { status: 503 },
  );
  clearSessionCookie(response, configuration);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const result = getAuthConfiguration();
  if (!result.available) {
    const response = privateJson(
      {
        signedOut: true,
        serverSessionRevoked: false,
        warning:
          "The browser credential was cleared, but the server session could not be revoked because sign-in is not configured.",
        error: {
          code: "auth_unavailable",
          message: "FactGrid sign-in is not configured for this deployment.",
        },
      },
      { status: 503 },
    );
    // OAuth configuration can disappear while a browser still holds a local
    // credential. Revocation cannot be confirmed without the configured store,
    // but the browser must not retain a session that could silently revive.
    clearSessionCookie(response, { secureCookies: process.env.NODE_ENV === "production" });
    return response;
  }

  if (!isSameOriginRequest(request, result.config.appOrigin)) {
    return privateJson(
      {
        signedOut: false,
        serverSessionRevoked: false,
        error: {
          code: "invalid_origin",
          message: "The logout request did not come from this application.",
        },
      },
      { status: 403 },
    );
  }

  const token = readSessionToken(request);
  let store: SessionStore;
  let session: SessionSummary | null;
  try {
    store = getSessionStore(result.config);
    session = store.getSummary(token);
  } catch {
    return sessionRevocationUnavailable(result.config);
  }
  if (session && !hasValidCsrfToken(request, session.csrfToken, CSRF_HEADER_NAME)) {
    return privateJson(
      {
        signedOut: false,
        serverSessionRevoked: false,
        error: {
          code: "invalid_csrf_token",
          message: "The logout request could not be verified.",
        },
      },
      { status: 403 },
    );
  }

  try {
    store.delete(token);
  } catch {
    return sessionRevocationUnavailable(result.config);
  }
  const response = privateJson({ signedOut: true, serverSessionRevoked: true });
  clearSessionCookie(response, result.config);
  return response;
}
