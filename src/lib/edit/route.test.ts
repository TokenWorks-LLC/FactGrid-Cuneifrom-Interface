import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  readSessionToken: vi.fn(),
  clearSessionCookie: vi.fn(),
  getUsableProviderSession: vi.fn(),
  hasValidCsrfToken: vi.fn(() => true),
  isSameOriginRequest: vi.fn(() => true),
  isApprovedEditor: vi.fn(),
  fetchFactGridProfile: vi.fn(),
  saveTranscript: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

vi.mock("@/lib/auth/config", () => ({
  getAuthConfiguration: () => ({
    available: true,
    config: {
      appOrigin: "https://app.example",
      callbackUrl: "https://app.example/api/auth/callback",
      clientId: "client",
      clientSecret: "secret",
      sessionDbPath: ":memory:",
      sessionSecret: "x".repeat(32),
      secureCookies: true,
      editingEnabled: true,
      allowedEditors: new Set(["Editor"]),
      oauth: {
        issuer: "https://database.factgrid.de",
        authorizationEndpoint: "https://database.factgrid.de/authorize",
        tokenEndpoint: "https://database.factgrid.de/token",
        profileEndpoint: "https://database.factgrid.de/profile",
      },
    },
  }),
}));
vi.mock("@/lib/auth/oauth", () => ({ fetchFactGridProfile: mocks.fetchFactGridProfile }));
vi.mock("@/lib/auth/policy", () => ({
  hasValidCsrfToken: mocks.hasValidCsrfToken,
  isSameOriginRequest: mocks.isSameOriginRequest,
  isApprovedEditor: mocks.isApprovedEditor,
}));
vi.mock("@/lib/auth/provider-session", () => ({
  getUsableProviderSession: mocks.getUsableProviderSession,
}));
vi.mock("@/lib/auth/session", () => ({
  readSessionToken: mocks.readSessionToken,
  clearSessionCookie: mocks.clearSessionCookie,
}));
vi.mock("@/lib/edit/factgrid-write", () => ({ saveTranscript: mocks.saveTranscript }));

import { PUT } from "@/app/api/tablets/[qid]/editions/[editionId]/route";

const context = {
  params: Promise.resolve({ qid: "Q42", editionId: "Q42$A1-B2" }),
};

function request(): Parameters<typeof PUT>[0] {
  return new Request("https://app.example/api/tablets/Q42/editions/Q42%24A1-B2", {
    method: "PUT",
    headers: {
      Origin: "https://app.example",
      "Content-Type": "application/json",
      "X-CSRF-Token": "browser-csrf",
    },
    body: JSON.stringify({ baseRevision: 100, text: "draft", summary: "" }),
  }) as Parameters<typeof PUT>[0];
}

describe("transcript write route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasValidCsrfToken.mockReturnValue(true);
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.revalidatePath.mockImplementation(() => undefined);
  });

  it("denies an anonymous direct API write", async () => {
    mocks.readSessionToken.mockReturnValue(null);

    const response = await PUT(request(), context);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "authentication_required" },
    });
    expect(mocks.saveTranscript).not.toHaveBeenCalled();
  });

  it("denies a signed-in user outside the explicit editor policy", async () => {
    mocks.readSessionToken.mockReturnValue("opaque-session");
    mocks.getUsableProviderSession.mockResolvedValue({
      providerUserId: "17",
      username: "Editor",
      accessToken: "provider-token",
      refreshToken: null,
      accessTokenExpiresAt: null,
      expiresAt: Date.now() + 60_000,
      csrfToken: "browser-csrf",
    });
    mocks.isApprovedEditor.mockReturnValue(false);

    const response = await PUT(request(), context);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "editor_not_authorized" },
    });
    expect(mocks.fetchFactGridProfile).not.toHaveBeenCalled();
    expect(mocks.saveTranscript).not.toHaveBeenCalled();
  });

  it("returns a confirmed save even when local cache invalidation fails", async () => {
    mocks.readSessionToken.mockReturnValue("opaque-session");
    mocks.getUsableProviderSession.mockResolvedValue({
      providerUserId: "17",
      username: "Editor",
      accessToken: "provider-token",
      refreshToken: null,
      accessTokenExpiresAt: null,
      expiresAt: Date.now() + 60_000,
      csrfToken: "browser-csrf",
    });
    mocks.isApprovedEditor.mockReturnValue(true);
    mocks.fetchFactGridProfile.mockResolvedValue({
      providerUserId: "17",
      username: "Editor",
      blocked: false,
      groups: [],
      rights: ["edit"],
    });
    mocks.saveTranscript.mockResolvedValue({ revisionId: 101, text: "draft" });
    mocks.revalidatePath.mockImplementation(() => {
      throw new Error("cache unavailable");
    });

    const response = await PUT(request(), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      revisionId: 101,
      text: "draft",
    });
    expect(mocks.saveTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ qid: "Q42", editionId: "Q42$A1-B2" }),
    );
  });
});
