import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/config";
import { isApprovedEditor } from "@/lib/auth/policy";
import { authUnavailable, privateJson } from "@/lib/auth/responses";
import { clearSessionCookie, readSession, readSessionToken } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = getAuthConfiguration();
  if (!result.available) return authUnavailable();

  try {
    const session = readSession(request, result.config);
    if (!session) {
      const response = privateJson({ authenticated: false });
      if (readSessionToken(request)) clearSessionCookie(response, result.config);
      return response;
    }

    return privateJson({
      authenticated: true,
      user: {
        id: session.providerUserId,
        username: session.username,
      },
      expiresAt: new Date(session.expiresAt).toISOString(),
      csrfToken: session.csrfToken,
      editorApproved: isApprovedEditor(session.username, result.config),
    });
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
}
