import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionStore: vi.fn(),
  refreshProviderTokens: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./session", () => ({ getSessionStore: mocks.getSessionStore }));
vi.mock("./oauth", () => ({ refreshProviderTokens: mocks.refreshProviderTokens }));

import type { AuthConfiguration } from "./config";
import { getUsableProviderSession } from "./provider-session";

const configuration = {} as AuthConfiguration;
const now = 1_700_000_000_000;
const session = {
  providerUserId: "17",
  username: "Editor",
  accessToken: "old-access",
  refreshToken: "refresh-token",
  accessTokenExpiresAt: now + 30_000,
  expiresAt: now + 60_000,
  csrfToken: "browser-csrf",
};

describe("getUsableProviderSession", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a token that remains valid beyond the refresh window", async () => {
    const store = { get: vi.fn().mockReturnValue({ ...session, accessTokenExpiresAt: now + 120_000 }) };
    mocks.getSessionStore.mockReturnValue(store);

    await expect(
      getUsableProviderSession("opaque-session", configuration, now),
    ).resolves.toMatchObject({ accessToken: "old-access" });
    expect(mocks.refreshProviderTokens).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token and keeps a rotated refresh token", async () => {
    const refreshedSession = {
      ...session,
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accessTokenExpiresAt: now + 3_600_000,
    };
    const store = {
      get: vi.fn().mockReturnValueOnce(session).mockReturnValueOnce(refreshedSession),
      updateProviderTokens: vi.fn().mockReturnValue(true),
    };
    mocks.getSessionStore.mockReturnValue(store);
    mocks.refreshProviderTokens.mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      accessTokenExpiresAt: now + 3_600_000,
    });

    await expect(
      getUsableProviderSession("opaque-session", configuration, now),
    ).resolves.toEqual(refreshedSession);
    expect(store.updateProviderTokens).toHaveBeenCalledWith(
      "opaque-session",
      {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        accessTokenExpiresAt: now + 3_600_000,
      },
      now,
    );
  });

  it("fails closed when refresh fails or the session cannot be updated", async () => {
    const store = {
      get: vi.fn().mockReturnValue(session),
      updateProviderTokens: vi.fn().mockReturnValue(false),
    };
    mocks.getSessionStore.mockReturnValue(store);
    mocks.refreshProviderTokens.mockResolvedValue({
      accessToken: "new-access",
      refreshToken: null,
      accessTokenExpiresAt: now + 3_600_000,
    });

    await expect(
      getUsableProviderSession("opaque-session", configuration, now),
    ).resolves.toBeNull();

    mocks.refreshProviderTokens.mockRejectedValue(new Error("provider unavailable"));
    await expect(
      getUsableProviderSession("opaque-session", configuration, now),
    ).resolves.toBeNull();
  });
});
