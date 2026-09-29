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
  verifyFreshEditorProfile: vi.fn(() => ({ providerUserId: "17", username: "Editor" })),
  parseMetadataWriteRequest: vi.fn(),
  rateLimitCheck: vi.fn(),
  createMetadataMutationClient: vi.fn(() => ({})),
  saveMetadata: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/config", () => ({
  getAuthConfiguration: () => ({ available: true, config: {
    appOrigin: "https://app.example", callbackUrl: "https://app.example/api/auth/callback",
    clientId: "client", clientSecret: "secret", sessionDbPath: ":memory:",
    sessionSecret: "x".repeat(32), secureCookies: true, editingEnabled: true,
    contributorPolicy: "authenticated", allowedEditors: new Set(["Editor"]), oauthVersion: "1.0a",
    oauth: { issuer: "https://database.factgrid.de", authorizationEndpoint: "https://database.factgrid.de/wiki/Special:OAuth/authorize", tokenEndpoint: "https://database.factgrid.de/w/index.php?title=Special:OAuth/token", profileEndpoint: "https://database.factgrid.de/w/index.php?title=Special:OAuth/identify" },
  } }),
}));
vi.mock("@/lib/auth/oauth", () => ({ fetchFactGridProfile: mocks.fetchFactGridProfile, providerAuthorizationHeader: mocks.providerAuthorizationHeader }));
vi.mock("@/lib/auth/policy", () => ({ hasValidCsrfToken: mocks.hasValidCsrfToken, isSameOriginRequest: mocks.isSameOriginRequest, isApprovedEditor: mocks.isApprovedEditor }));
vi.mock("@/lib/auth/provider-session", () => ({ getUsableProviderSession: mocks.getUsableProviderSession }));
vi.mock("@/lib/auth/session", () => ({ readSessionToken: mocks.readSessionToken, clearSessionCookie: mocks.clearSessionCookie }));
vi.mock("@/lib/edit/authorization", () => ({ verifyFreshEditorProfile: mocks.verifyFreshEditorProfile }));
vi.mock("@/lib/edit/rate-limit", () => ({ writeRateLimiter: { check: mocks.rateLimitCheck } }));
vi.mock("@/lib/edit/metadata-request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./metadata-request")>()),
  parseMetadataWriteRequest: mocks.parseMetadataWriteRequest,
}));
vi.mock("@/lib/edit/metadata-write", () => ({ createMetadataMutationClient: mocks.createMetadataMutationClient, saveMetadata: mocks.saveMetadata }));

import { PUT } from "@/app/api/tablets/[qid]/metadata/route";
import { TranscriptEditError } from "./errors";

const context = { params: Promise.resolve({ qid: "Q42" }) };

function request(): Parameters<typeof PUT>[0] {
  return new Request("https://app.example/api/tablets/Q42/metadata", {
    method: "PUT", headers: { Origin: "https://app.example", "Content-Type": "application/json", "X-CSRF-Token": "browser-csrf" }, body: "{}",
  }) as Parameters<typeof PUT>[0];
}

function authenticate(): void {
  mocks.readSessionToken.mockReturnValue("opaque-session");
  mocks.getUsableProviderSession.mockResolvedValue({
    providerUserId: "17", username: "Editor", accessToken: "provider-token", accessTokenSecret: "provider-secret",
    oauthVersion: "1.0a", refreshToken: null, accessTokenExpiresAt: null, expiresAt: Date.now() + 60_000, csrfToken: "browser-csrf",
  });
  mocks.fetchFactGridProfile.mockResolvedValue({ providerUserId: "17", username: "Editor", blocked: false, groups: [], rights: ["edit"], grants: ["editpage"] });
  mocks.parseMetadataWriteRequest.mockResolvedValue({ baseRevision: 1, summary: "Edit", confirmRemovals: false, confirmCatalogueRemoval: false, operations: [{ type: "set-label", language: "en", value: "Tablet" }] });
}

describe("metadata mutation route security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasValidCsrfToken.mockReturnValue(true);
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.isApprovedEditor.mockReturnValue(true);
  });

  it("rejects a foreign origin before reading a session", async () => {
    mocks.isSameOriginRequest.mockReturnValue(false);
    const response = await PUT(request(), context);
    expect(response.status).toBe(403);
    expect(mocks.readSessionToken).not.toHaveBeenCalled();
  });

  it("rejects anonymous and invalid-CSRF requests before parsing metadata", async () => {
    mocks.readSessionToken.mockReturnValue(null);
    expect((await PUT(request(), context)).status).toBe(401);
    authenticate();
    mocks.hasValidCsrfToken.mockReturnValue(false);
    expect((await PUT(request(), context)).status).toBe(403);
    expect(mocks.parseMetadataWriteRequest).not.toHaveBeenCalled();
  });

  it("surfaces fresh provider authorization failures without writing", async () => {
    authenticate();
    mocks.verifyFreshEditorProfile.mockImplementationOnce(() => {
      throw new TranscriptEditError("account_blocked", "blocked", { status: 403 });
    });
    const response = await PUT(request(), context);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "account_blocked" } });
    expect(mocks.saveMetadata).not.toHaveBeenCalled();
  });
});
