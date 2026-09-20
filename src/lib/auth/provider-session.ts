import "server-only";

import type { AuthConfiguration } from "./config";
import { refreshProviderTokens } from "./oauth";
import { getSessionStore } from "./session";
import type { StoredSession } from "./session-store";

export async function getUsableProviderSession(
  sessionToken: string,
  configuration: AuthConfiguration,
  now = Date.now(),
): Promise<StoredSession | null> {
  const store = getSessionStore(configuration);
  const session = store.get(sessionToken, now);
  if (!session) return null;
  if (
    session.accessTokenExpiresAt === null ||
    session.accessTokenExpiresAt > now + 60_000
  ) {
    return session;
  }
  if (!session.refreshToken) return null;

  try {
    const refreshed = await refreshProviderTokens(
      session.refreshToken,
      configuration,
      now,
    );
    if (
      !store.updateProviderTokens(
        sessionToken,
        {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? undefined,
          accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
        },
        now,
      )
    ) {
      return null;
    }
    return store.get(sessionToken, now);
  } catch {
    return null;
  }
}
