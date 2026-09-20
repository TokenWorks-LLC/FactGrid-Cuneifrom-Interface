import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/config";
import { CSRF_HEADER_NAME } from "@/lib/auth/constants";
import { fetchFactGridProfile } from "@/lib/auth/oauth";
import {
  hasValidCsrfToken,
  isApprovedEditor,
  isSameOriginRequest,
} from "@/lib/auth/policy";
import { getUsableProviderSession } from "@/lib/auth/provider-session";
import { authUnavailable, privateJson } from "@/lib/auth/responses";
import {
  clearSessionCookie,
  readSessionToken,
} from "@/lib/auth/session";
import { verifyFreshEditorProfile } from "@/lib/edit/authorization";
import {
  isTranscriptEditError,
  type TranscriptEditError,
} from "@/lib/edit/errors";
import { saveTranscript } from "@/lib/edit/factgrid-write";
import { writeRateLimiter } from "@/lib/edit/rate-limit";
import { parseTranscriptWriteRequest } from "@/lib/edit/request";
import { isFactGridError, type FactGridError } from "@/lib/factgrid/errors";
import { parseEditionId, parseQid } from "@/lib/factgrid/validation";

export const runtime = "nodejs";

type RouteParameters = {
  params: Promise<{ qid: string; editionId: string }>;
};

function errorResponse(
  status: number,
  code: string,
  message: string,
  options: { retryAfterSeconds?: number; saveStatus?: string } = {},
): NextResponse {
  const response = privateJson(
    {
      error: { code, message },
      message,
      ...(options.saveStatus ? { saveStatus: options.saveStatus } : {}),
    },
    { status },
  );
  if (options.retryAfterSeconds !== undefined) {
    response.headers.set("Retry-After", String(options.retryAfterSeconds));
  }
  return response;
}

function transcriptErrorResponse(error: TranscriptEditError): NextResponse {
  return errorResponse(error.status, error.code, error.message, {
    retryAfterSeconds: error.retryAfterSeconds,
    saveStatus:
      error.code === "save_status_unknown"
        ? "unknown"
        : error.code === "save_confirmation_failed"
          ? "accepted_unconfirmed"
          : undefined,
  });
}

function factGridErrorResponse(error: FactGridError): NextResponse {
  switch (error.code) {
    case "INVALID_INPUT":
      return errorResponse(400, "invalid_request", error.message);
    case "NOT_FOUND":
    case "NOT_IN_CATALOGUE":
      return errorResponse(404, "tablet_not_found", "The requested tablet was not found.");
    case "UNSUPPORTED_DOCUMENT":
      return errorResponse(409, "unsupported_edition", error.message);
    case "TRANSCRIPT_CONFLICT":
      return errorResponse(
        409,
        "edit_conflict",
        "The transcript source changed before it could be saved. Reload before trying again.",
      );
    default:
      return errorResponse(
        error.status === 504 ? 504 : 502,
        "factgrid_unavailable",
        "FactGrid could not complete the request. Your draft has not been cleared.",
      );
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteParameters,
): Promise<NextResponse> {
  const configurationResult = getAuthConfiguration();
  if (!configurationResult.available) return authUnavailable();
  const configuration = configurationResult.config;

  if (!isSameOriginRequest(request, configuration.appOrigin)) {
    return errorResponse(
      403,
      "invalid_origin",
      "The save request did not come from this application.",
    );
  }

  let qid: ReturnType<typeof parseQid>;
  let editionId: string;
  try {
    const parameters = await context.params;
    qid = parseQid(parameters.qid);
    editionId = parseEditionId(parameters.editionId, qid);
  } catch (error) {
    if (isFactGridError(error)) return factGridErrorResponse(error);
    return errorResponse(400, "invalid_request", "The tablet or edition identifier is invalid.");
  }

  const sessionToken = readSessionToken(request);
  if (!sessionToken) {
    return errorResponse(401, "authentication_required", "Sign in with FactGrid before saving.");
  }

  let session: Awaited<ReturnType<typeof getUsableProviderSession>>;
  try {
    session = await getUsableProviderSession(sessionToken, configuration);
  } catch {
    return errorResponse(
      503,
      "session_unavailable",
      "The session service is temporarily unavailable.",
    );
  }
  if (!session) {
    const response = errorResponse(
      401,
      "authentication_required",
      "The session has expired. Sign in with FactGrid again.",
    );
    clearSessionCookie(response, configuration);
    return response;
  }
  if (!hasValidCsrfToken(request, session.csrfToken, CSRF_HEADER_NAME)) {
    return errorResponse(
      403,
      "invalid_csrf_token",
      "The save request could not be verified.",
    );
  }
  if (!isApprovedEditor(session.username, configuration)) {
    return errorResponse(
      403,
      "editor_not_authorized",
      "This account is not approved to edit through this interface.",
    );
  }

  let writeRequest: Awaited<ReturnType<typeof parseTranscriptWriteRequest>>;
  try {
    writeRequest = await parseTranscriptWriteRequest(request);
    writeRateLimiter.check(session.providerUserId);
  } catch (error) {
    if (isTranscriptEditError(error)) return transcriptErrorResponse(error);
    return errorResponse(400, "invalid_request", "The transcript edit request is invalid.");
  }

  let profile: Awaited<ReturnType<typeof fetchFactGridProfile>>;
  try {
    // Authorization is re-fetched for every write; session-time profile data is
    // deliberately not trusted for current rights or block status.
    profile = await fetchFactGridProfile(session.accessToken, configuration);
  } catch {
    return errorResponse(
      502,
      "factgrid_unavailable",
      "FactGrid could not verify the current account permissions.",
    );
  }

  try {
    const identity = verifyFreshEditorProfile(session, profile, configuration);
    const saved = await saveTranscript({
      qid,
      editionId,
      accessToken: session.accessToken,
      identity,
      request: writeRequest,
    });

    // The FactGrid write and readback are already confirmed. A local cache
    // invalidation failure must not turn that success into an ambiguous retry.
    try {
      revalidatePath(`/tablets/${qid}`);
    } catch {
      // The short public revalidation window remains the safe fallback.
    }
    return privateJson({
      revisionId: saved.revisionId,
      text: saved.text,
      message: `Saved as FactGrid revision ${saved.revisionId}.`,
    });
  } catch (error) {
    if (isTranscriptEditError(error)) return transcriptErrorResponse(error);
    if (isFactGridError(error)) return factGridErrorResponse(error);
    return errorResponse(
      500,
      "save_failed",
      "The edit could not be completed. Your draft has not been cleared.",
    );
  }
}
