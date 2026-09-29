import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import { getAuthConfiguration } from "@/lib/auth/config";
import { CSRF_HEADER_NAME } from "@/lib/auth/constants";
import { fetchFactGridProfile, providerAuthorizationHeader } from "@/lib/auth/oauth";
import { hasValidCsrfToken, isApprovedEditor, isSameOriginRequest } from "@/lib/auth/policy";
import { getUsableProviderSession } from "@/lib/auth/provider-session";
import { authUnavailable, privateJson } from "@/lib/auth/responses";
import { clearSessionCookie, readSessionToken } from "@/lib/auth/session";
import { verifyFreshEditorProfile } from "@/lib/edit/authorization";
import { isTranscriptEditError, type TranscriptEditError } from "@/lib/edit/errors";
import { adaptMetadataEditModel } from "@/lib/edit/metadata-dto";
import { parseMetadataWriteRequest } from "@/lib/edit/metadata-request";
import { createMetadataMutationClient, saveMetadata } from "@/lib/edit/metadata-write";
import { writeRateLimiter } from "@/lib/edit/rate-limit";
import { isFactGridError, type FactGridError } from "@/lib/factgrid/errors";
import { createFactGridClient } from "@/lib/factgrid/server";
import { parseQid } from "@/lib/factgrid/validation";

export const runtime = "nodejs";

type RouteParameters = { params: Promise<{ qid: string }> };

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
  if (error.code === "INVALID_INPUT") return errorResponse(400, "invalid_request", error.message);
  if (error.code === "NOT_FOUND" || error.code === "NOT_IN_CATALOGUE") {
    return errorResponse(404, "tablet_not_found", "The requested tablet was not found.");
  }
  return errorResponse(
    error.status === 504 ? 504 : 502,
    "factgrid_unavailable",
    "FactGrid could not complete the metadata request.",
  );
}

function additionalProperties(request: NextRequest): string[] {
  return request.nextUrl.searchParams
    .getAll("properties")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function GET(
  request: NextRequest,
  context: RouteParameters,
): Promise<NextResponse> {
  let qid: ReturnType<typeof parseQid>;
  try {
    qid = parseQid((await context.params).qid);
    const factGrid = createFactGridClient({ revalidateSeconds: false });
    const snapshot = await factGrid.getEditableTabletEntity(qid, additionalProperties(request));
    return privateJson(adaptMetadataEditModel(snapshot));
  } catch (error) {
    if (isFactGridError(error)) return factGridErrorResponse(error);
    return errorResponse(400, "invalid_request", "The tablet or property identifiers are invalid.");
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
    return errorResponse(403, "invalid_origin", "The save request did not come from this application.");
  }

  let qid: ReturnType<typeof parseQid>;
  try {
    qid = parseQid((await context.params).qid);
  } catch {
    return errorResponse(400, "invalid_request", "The tablet identifier is invalid.");
  }

  const sessionToken = readSessionToken(request);
  if (!sessionToken) {
    return errorResponse(401, "authentication_required", "Sign in with FactGrid before saving.");
  }
  let session: Awaited<ReturnType<typeof getUsableProviderSession>>;
  try {
    session = await getUsableProviderSession(sessionToken, configuration);
  } catch {
    return errorResponse(503, "session_unavailable", "The session service is temporarily unavailable.");
  }
  if (!session) {
    const response = errorResponse(401, "authentication_required", "The session has expired. Sign in again.");
    clearSessionCookie(response, configuration);
    return response;
  }
  if (!hasValidCsrfToken(request, session.csrfToken, CSRF_HEADER_NAME)) {
    return errorResponse(403, "invalid_csrf_token", "The save request could not be verified.");
  }
  if (!isApprovedEditor(session.username, configuration)) {
    return errorResponse(403, "editor_not_authorized", "This account is not approved to edit here.");
  }

  let writeRequest: Awaited<ReturnType<typeof parseMetadataWriteRequest>>;
  try {
    writeRequest = await parseMetadataWriteRequest(request);
    writeRateLimiter.check(session.providerUserId);
  } catch (error) {
    if (isTranscriptEditError(error)) return transcriptErrorResponse(error);
    return errorResponse(400, "invalid_request", "The metadata edit request is invalid.");
  }

  let profile: Awaited<ReturnType<typeof fetchFactGridProfile>>;
  try {
    profile = await fetchFactGridProfile(
      session.accessToken,
      configuration,
      session.accessTokenSecret,
    );
  } catch {
    return errorResponse(502, "factgrid_unavailable", "FactGrid could not verify account permissions.");
  }

  try {
    const identity = verifyFreshEditorProfile(session, profile, configuration);
    const mutationClient = createMetadataMutationClient({
      authorizationHeader: (accessToken, method, url, body) =>
        providerAuthorizationHeader(
          configuration,
          {
            accessToken,
            accessTokenSecret: session.accessTokenSecret,
            oauthVersion: session.oauthVersion,
          },
          method,
          url,
          body,
        ),
    });
    const saved = await saveMetadata(
      {
        qid,
        accessToken: session.accessToken,
        identity,
        request: writeRequest,
      },
      { mutationClient },
    );
    try {
      revalidatePath(`/tablets/${qid}`);
      revalidatePath(`/tablets/${qid}/edit`);
    } catch {
      // Upstream readback already confirmed success; cache expiry is the fallback.
    }
    return privateJson({
      ...adaptMetadataEditModel(saved.snapshot),
      revisionId: saved.revisionId,
      message: `Saved metadata as FactGrid revision ${saved.revisionId}.`,
    });
  } catch (error) {
    if (isTranscriptEditError(error)) return transcriptErrorResponse(error);
    if (isFactGridError(error)) return factGridErrorResponse(error);
    return errorResponse(500, "save_failed", "The metadata edit could not be completed. The draft was not cleared.");
  }
}
