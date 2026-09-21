import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearSessionCookie: vi.fn(),
  getSessionStore: vi.fn(),
  hasValidCsrfToken: vi.fn(() => true),
  isSameOriginRequest: vi.fn(() => true),
  readSessionToken: vi.fn(() => "opaque-session"),
}));

vi.mock("@/lib/auth/config", () => ({
  getAuthConfiguration: () => ({
    available: true,
    config: {
      appOrigin: "https://app.example",
      secureCookies: true,
    },
  }),
}));
vi.mock("@/lib/auth/policy", () => ({
  hasValidCsrfToken: mocks.hasValidCsrfToken,
  isSameOriginRequest: mocks.isSameOriginRequest,
}));
vi.mock("@/lib/auth/session", () => ({
  clearSessionCookie: mocks.clearSessionCookie,
  getSessionStore: mocks.getSessionStore,
  readSessionToken: mocks.readSessionToken,
}));

import { POST } from "@/app/api/auth/logout/route";

function request(): Parameters<typeof POST>[0] {
  return new Request("https://app.example/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "https://app.example",
      "X-CSRF-Token": "browser-csrf",
    },
  }) as Parameters<typeof POST>[0];
}

describe("logout route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isSameOriginRequest.mockReturnValue(true);
    mocks.hasValidCsrfToken.mockReturnValue(true);
    mocks.readSessionToken.mockReturnValue("opaque-session");
  });

  it("rejects foreign origins before opening the session store", async () => {
    mocks.isSameOriginRequest.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.getSessionStore).not.toHaveBeenCalled();
  });

  it("requires the application CSRF token for an active session", async () => {
    mocks.getSessionStore.mockReturnValue({
      getSummary: vi.fn().mockReturnValue({ csrfToken: "browser-csrf" }),
      delete: vi.fn(),
    });
    mocks.hasValidCsrfToken.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.clearSessionCookie).not.toHaveBeenCalled();
  });

  it("clears the browser credential when server-side revocation is unavailable", async () => {
    mocks.getSessionStore.mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.clearSessionCookie).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ secureCookies: true }),
    );
  });

  it("deletes the local session and clears the cookie on success", async () => {
    const store = {
      getSummary: vi.fn().mockReturnValue({ csrfToken: "browser-csrf" }),
      delete: vi.fn().mockReturnValue(true),
    };
    mocks.getSessionStore.mockReturnValue(store);

    const response = await POST(request());

    expect(response.status).toBe(204);
    expect(store.delete).toHaveBeenCalledWith("opaque-session");
    expect(mocks.clearSessionCookie).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ secureCookies: true }),
    );
  });

  it("clears the browser credential when session deletion fails", async () => {
    const store = {
      getSummary: vi.fn().mockReturnValue({ csrfToken: "browser-csrf" }),
      delete: vi.fn().mockImplementation(() => {
        throw new Error("database locked");
      }),
    };
    mocks.getSessionStore.mockReturnValue(store);

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.clearSessionCookie).toHaveBeenCalledWith(
      response,
      expect.objectContaining({ secureCookies: true }),
    );
  });
});
