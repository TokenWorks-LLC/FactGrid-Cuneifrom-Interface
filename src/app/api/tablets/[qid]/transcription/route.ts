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
import { isTranscriptEditError } from "@/lib/edit/errors";
import { writeRateLimiter } from "@/lib/edit/rate-limit";
import { parseAllowedEditTargets } from "@/lib/edit/targets";
import {
  createTranscription,
  createTranscriptionCreationProvider,
  isTranscriptionCreationError,
  parseTranscriptionCreateRequest,
  type TranscriptionCreationError,
} from "@/lib/edit/transcription-create";
import { isFactGridError } from "@/lib/factgrid/errors";
import { parseQid } from "@/lib/factgrid/validation";

export const runtime = "nodejs";

type RouteParameters = { params: Promise<{ qid: string }> };

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return privateJson({ error: { code, message }, message, ...extra }, { status });
}

function creationErrorResponse(error: TranscriptionCreationError): NextResponse {
  return errorResponse(error.status, error.code, error.message, {
    ...(error.state ? { state: error.state } : {}),
    ...(error.recovery ? { recovery: error.recovery } : {}),
    ...(error.code.includes("status_unknown")
      ? { saveStatus: "unknown" }
      : error.code.includes("confirmation_failed")
        ? { saveStatus: "accepted_unconfirmed" }
        : error.recovery
          ? { saveStatus: "partial" }
          : {}),
  });
}

export async function POST(
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
  } catch (error) {
    if (isFactGridError(error)) {
      return errorResponse(400, "invalid_request", error.message);
    }
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
    const response = errorResponse(
      401,
      "authentication_required",
      "The session has expired. Sign in with FactGrid again.",
    );
    clearSessionCookie(response, configuration);
    return response;
  }
  if (!hasValidCsrfToken(request, session.csrfToken, CSRF_HEADER_NAME)) {
    return errorResponse(403, "invalid_csrf_token", "The save request could not be verified.");
  }
  if (!isApprovedEditor(session.username, configuration)) {
    return errorResponse(
      403,
      "editor_not_authorized",
      "This account is not approved to edit through this interface.",
    );
  }

  let writeRequest: Awaited<ReturnType<typeof parseTranscriptionCreateRequest>>;
  try {
    writeRequest = await parseTranscriptionCreateRequest(request);
    writeRateLimiter.check(session.providerUserId);
  } catch (error) {
    if (isTranscriptionCreationError(error)) return creationErrorResponse(error);
    return errorResponse(400, "invalid_request", "The transcription creation request is invalid.");
  }

  let profile: Awaited<ReturnType<typeof fetchFactGridProfile>>;
  try {
    profile = await fetchFactGridProfile(
      session.accessToken,
      configuration,
      session.accessTokenSecret,
    );
  } catch {
    return errorResponse(
      502,
      "factgrid_unavailable",
      "FactGrid could not verify the current account permissions.",
    );
  }

  try {
    const identity = verifyFreshEditorProfile(session, profile, configuration);
    if (!profile.rights.includes("createpage")) {
      return errorResponse(
        403,
        "missing_create_right",
        "This FactGrid account does not currently have the create-page right.",
      );
    }
    if (
      profile.grants !== undefined &&
      !profile.grants.includes("createeditmovepage")
    ) {
      return errorResponse(
        403,
        "missing_create_grant",
        "The connected FactGrid application was not granted permission to create pages. Sign in again after the required grant is approved.",
      );
    }
    const provider = createTranscriptionCreationProvider({
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
    const created = await createTranscription(
      {
        qid,
        accessToken: session.accessToken,
        identity,
        request: writeRequest,
        contributorPolicy: configuration.contributorPolicy,
        allowedTargets: parseAllowedEditTargets(process.env.FACTGRID_ALLOWED_EDIT_TARGETS),
      },
      { provider },
    );
    try {
      revalidatePath(`/tablets/${qid}`);
      revalidatePath(`/tablets/${qid}/edit`);
    } catch {
      // The confirmed upstream result remains successful if local revalidation fails.
    }
    return privateJson(
      {
        ...created,
        message:
          created.status === "already_available"
            ? "The FactGrid transcription document is already available."
            : `Created and confirmed FactGrid document revision ${created.pageRevisionId}.`,
      },
      { status: created.status === "already_available" ? 200 : 201 },
    );
  } catch (error) {
    if (isTranscriptionCreationError(error)) return creationErrorResponse(error);
    if (isTranscriptEditError(error)) {
      return errorResponse(error.status, error.code, error.message);
    }
    return errorResponse(
      500,
      "save_failed",
      "The transcription could not be created. Your draft has not been cleared.",
    );
  }
}
