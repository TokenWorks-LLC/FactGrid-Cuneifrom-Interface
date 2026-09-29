import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  readSessionToken: vi.fn(),
  clearSessionCookie: vi.fn(),
  getUsableProviderSession: vi.fn(),
  hasValidCsrfToken: vi.fn(() => true),
  isSameOriginRequest: vi.fn(() => true),
  isApprovedEditor: vi.fn(() => true),
  fetchFactGridProfile: vi.fn(),
  providerAuthorizationHeader: vi.fn(() => "OAuth signed"),
  verifyFreshEditorProfile: vi.fn(() => ({
    providerUserId: "17",
    username: "Editor",
  })),
  parseTranscriptionCreateRequest: vi.fn(),
  rateLimitCheck: vi.fn(),
  createTranscriptionCreationProvider: vi.fn(() => ({
    inspect: vi.fn(),
    createPage: vi.fn(),
    linkPage: vi.fn(),
  })),
  createTranscription: vi.fn(),
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
      contributorPolicy: "authenticated",
      allowedEditors: new Set(["Editor"]),
      oauthVersion: "1.0a",
      oauth: {
        issuer: "https://database.factgrid.de",
        authorizationEndpoint: "https://database.factgrid.de/wiki/Special:OAuth/authorize",
        tokenEndpoint: "https://database.factgrid.de/w/index.php?title=Special:OAuth/token",
        profileEndpoint: "https://database.factgrid.de/w/index.php?title=Special:OAuth/identify",
      },
    },
  }),
}));
vi.mock("@/lib/auth/oauth", () => ({
  fetchFactGridProfile: mocks.fetchFactGridProfile,
  providerAuthorizationHeader: mocks.providerAuthorizationHeader,
}));
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
vi.mock("@/lib/edit/authorization", () => ({
  verifyFreshEditorProfile: mocks.verifyFreshEditorProfile,
}));
vi.mock("@/lib/edit/rate-limit", () => ({
  writeRateLimiter: { check: mocks.rateLimitCheck },
}));
vi.mock("@/lib/edit/transcription-create", async (importOriginal) => {
  const original = await importOriginal<typeof import("./transcription-create")>();
  return {
    ...original,
    parseTranscriptionCreateRequest: mocks.parseTranscriptionCreateRequest,
    createTranscriptionCreationProvider: mocks.createTranscriptionCreationProvider,
    createTranscription: mocks.createTranscription,
  };
});

import { POST } from "@/app/api/tablets/[qid]/transcription/route";
import { TranscriptionCreationError } from "./transcription-create";

const context = { params: Promise.resolve({ qid: "Q42" }) };

function postRequest(): Parameters<typeof POST>[0] {
  return new Request("https://app.example/api/tablets/Q42/transcription", {
    method: "POST",
    headers: {
      Origin: "https://app.example",
      "Content-Type": "application/json",
      "X-CSRF-Token": "browser-csrf",
    },
    body: JSON.stringify({ text: "1. šarrum", summary: "Add reading" }),
  }) as Parameters<typeof POST>[0];
}

function authenticate(): void {
  mocks.readSessionToken.mockReturnValue("opaque-session");
  mocks.getUsableProviderSession.mockResolvedValue({
    providerUserId: "17",
    username: "Editor",
    accessToken: "provider-token",
    accessTokenSecret: "provider-secret",
    oauthVersion: "1.0a",
    refreshToken: null,
    accessTokenExpiresAt: null,
    expiresAt: Date.now() + 60_000,
    csrfToken: "browser-csrf",
  });
  mocks.fetchFactGridProfile.mockResolvedValue({
    providerUserId: "17",
    username: "Editor",
    blocked: false,
    groups: [],
    rights: ["edit", "createpage"],
  });
  mocks.parseTranscriptionCreateRequest.mockResolvedValue({
    text: "1. šarrum",
    summary: "Add reading",
  });
}

describe("transcription creation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasValidCsrfToken.mockReturnValue(true);
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.isApprovedEditor.mockReturnValue(true);
  });

  it("rejects anonymous creation without inspecting FactGrid", async () => {
    mocks.readSessionToken.mockReturnValue(null);

    const response = await POST(postRequest(), context);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "authentication_required" },
    });
    expect(mocks.createTranscription).not.toHaveBeenCalled();
  });

  it("rejects an invalid application CSRF token before parsing the draft", async () => {
    authenticate();
    mocks.hasValidCsrfToken.mockReturnValue(false);

    const response = await POST(postRequest(), context);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_csrf_token" } });
    expect(mocks.parseTranscriptionCreateRequest).not.toHaveBeenCalled();
    expect(mocks.createTranscription).not.toHaveBeenCalled();
  });

  it("requires the current create-page right and consumer grant before writing", async () => {
    authenticate();
    mocks.fetchFactGridProfile.mockResolvedValue({
      providerUserId: "17",
      username: "Editor",
      blocked: false,
      groups: [],
      rights: ["edit"],
      grants: ["editpage"],
    });

    const missingRight = await POST(postRequest(), context);
    expect(missingRight.status).toBe(403);
    expect(await missingRight.json()).toMatchObject({
      error: { code: "missing_create_right" },
    });
    expect(mocks.createTranscription).not.toHaveBeenCalled();

    mocks.fetchFactGridProfile.mockResolvedValue({
      providerUserId: "17",
      username: "Editor",
      blocked: false,
      groups: [],
      rights: ["edit", "createpage"],
      grants: ["editpage"],
    });
    const missingGrant = await POST(postRequest(), context);
    expect(missingGrant.status).toBe(403);
    expect(await missingGrant.json()).toMatchObject({
      error: { code: "missing_create_grant" },
    });
    expect(mocks.createTranscription).not.toHaveBeenCalled();
  });

  it("creates through the signed user provider and returns only a confirmed success", async () => {
    authenticate();
    mocks.createTranscription.mockResolvedValue({
      status: "created_and_linked",
      initialState: "no_local",
      title: "D-Q42",
      url: "https://database.factgrid.de/wiki/D-Q42",
      pageRevisionId: 101,
      entityRevisionId: 51,
      text: "1. šarrum",
    });

    const response = await POST(postRequest(), context);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: "created_and_linked",
      pageRevisionId: 101,
      entityRevisionId: 51,
    });
    expect(mocks.createTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        qid: "Q42",
        accessToken: "provider-token",
        identity: { providerUserId: "17", username: "Editor" },
      }),
      expect.objectContaining({ provider: expect.any(Object) }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/tablets/Q42");
  });

  it("returns actionable partial-success recovery after a confirmed page creation", async () => {
    authenticate();
    mocks.createTranscription.mockRejectedValue(
      new TranscriptionCreationError(
        "provider_rejected_link",
        "The page exists but the entity changed.",
        {
          status: 409,
          state: "no_local",
          recovery: {
            qid: "Q42",
            title: "D-Q42",
            url: "https://database.factgrid.de/wiki/D-Q42",
            pageRevisionId: 101,
            nextAction: "link_page",
          },
        },
      ),
    );

    const response = await POST(postRequest(), context);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "provider_rejected_link" },
      saveStatus: "partial",
      recovery: {
        title: "D-Q42",
        pageRevisionId: 101,
        nextAction: "link_page",
      },
    });
  });
});
