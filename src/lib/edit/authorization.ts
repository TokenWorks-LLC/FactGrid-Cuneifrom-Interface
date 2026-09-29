import type { AuthConfiguration } from "@/lib/auth/config";
import type { FactGridProfile } from "@/lib/auth/oauth";
import { isApprovedEditor } from "@/lib/auth/policy";
import type { StoredSession } from "@/lib/auth/session-store";

import { TranscriptEditError } from "./errors";

export interface VerifiedEditorIdentity {
  providerUserId: string;
  username: string;
}

export function verifyFreshEditorProfile(
  session: StoredSession,
  profile: FactGridProfile,
  configuration: Pick<
    AuthConfiguration,
    "allowedEditors" | "contributorPolicy" | "editingEnabled"
  >,
): VerifiedEditorIdentity {
  if (!isApprovedEditor(session.username, configuration)) {
    throw new TranscriptEditError(
      "editor_not_authorized",
      "This account is not approved to edit through this interface.",
      { status: 403 },
    );
  }
  if (
    profile.providerUserId !== session.providerUserId ||
    profile.username !== session.username
  ) {
    throw new TranscriptEditError(
      "identity_mismatch",
      "The FactGrid identity no longer matches this session. Sign in again.",
      { status: 401 },
    );
  }
  if (profile.blocked) {
    throw new TranscriptEditError(
      "account_blocked",
      "This FactGrid account is currently blocked from editing.",
      { status: 403 },
    );
  }
  if (!profile.rights.includes("edit")) {
    throw new TranscriptEditError(
      "missing_edit_right",
      "This FactGrid account does not currently have the edit right.",
      { status: 403 },
    );
  }
  if (
    profile.grants !== undefined &&
    !profile.grants.includes("editpage") &&
    !profile.grants.includes("createeditmovepage")
  ) {
    throw new TranscriptEditError(
      "missing_edit_right",
      "The connected FactGrid application was not granted permission to edit pages. Sign in again after the required grant is approved.",
      { status: 403 },
    );
  }
  return {
    providerUserId: profile.providerUserId,
    username: profile.username,
  };
}
