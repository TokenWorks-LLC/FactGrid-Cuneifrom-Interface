import { describe, expect, it } from "vitest";

import type { FactGridProfile } from "@/lib/auth/oauth";
import type { StoredSession } from "@/lib/auth/session-store";

import { verifyFreshEditorProfile } from "./authorization";

const session: StoredSession = {
  providerUserId: "17",
  username: "Editor",
  accessToken: "secret",
  refreshToken: null,
  accessTokenExpiresAt: null,
  expiresAt: Date.now() + 60_000,
  csrfToken: "browser-csrf",
};

const profile: FactGridProfile = {
  providerUserId: "17",
  username: "Editor",
  blocked: false,
  groups: ["user"],
  rights: ["read", "edit"],
};

const enabledPolicy = {
  editingEnabled: true,
  allowedEditors: new Set(["Editor"]),
};

describe("verifyFreshEditorProfile", () => {
  it("requires the switch, allowlist, current identity, block state, and edit right", () => {
    expect(verifyFreshEditorProfile(session, profile, enabledPolicy)).toEqual({
      providerUserId: "17",
      username: "Editor",
    });
    expect(() =>
      verifyFreshEditorProfile(session, profile, {
        ...enabledPolicy,
        editingEnabled: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "editor_not_authorized" }));
    expect(() =>
      verifyFreshEditorProfile(session, { ...profile, username: "Other" }, enabledPolicy),
    ).toThrowError(expect.objectContaining({ code: "identity_mismatch" }));
    expect(() =>
      verifyFreshEditorProfile(session, { ...profile, blocked: true }, enabledPolicy),
    ).toThrowError(expect.objectContaining({ code: "account_blocked" }));
    expect(() =>
      verifyFreshEditorProfile(session, { ...profile, rights: ["read"] }, enabledPolicy),
    ).toThrowError(expect.objectContaining({ code: "missing_edit_right" }));
  });
});
