import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/config";
import { CSRF_HEADER_NAME } from "@/lib/auth/constants";
import { hasValidCsrfToken, isSameOriginRequest } from "@/lib/auth/policy";
import { authUnavailable, noStore, privateJson } from "@/lib/auth/responses";
import {
  clearSessionCookie,
  getSessionStore,
  readSessionToken,
} from "@/lib/auth/session";
import type { SessionStore, SessionSummary } from "@/lib/auth/session-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const result = getAuthConfiguration();
  if (!result.available) return authUnavailable();

  if (!isSameOriginRequest(request, result.config.appOrigin)) {
    return privateJson(
      {
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
    return privateJson(
      {
        error: {
          code: "session_unavailable",
          message: "The session service is temporarily unavailable.",
        },
      },
      { status: 503 },
    );
  }
  if (session && !hasValidCsrfToken(request, session.csrfToken, CSRF_HEADER_NAME)) {
    return privateJson(
      {
        error: {
          code: "invalid_csrf_token",
          message: "The logout request could not be verified.",
        },
      },
      { status: 403 },
    );
  }

  store.delete(token);
  const response = new NextResponse(null, { status: 204 });
  clearSessionCookie(response, result.config);
  return noStore(response);
}
