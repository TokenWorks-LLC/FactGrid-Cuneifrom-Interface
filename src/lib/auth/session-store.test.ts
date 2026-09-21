import Database from "better-sqlite3";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SESSION_TTL_SECONDS } from "./constants";
import { SessionStore } from "./session-store";

const stores: SessionStore[] = [];
const temporaryDirectories: string[] = [];

function store(): SessionStore {
  const value = new SessionStore(new Database(":memory:"), "s".repeat(32));
  stores.push(value);
  return value;
}

afterEach(() => {
  for (const value of stores.splice(0)) value.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SessionStore", () => {
  it("stores only a hashed session ID and encrypted provider tokens", () => {
    const sessions = store();
    const created = sessions.create(
      {
        providerUserId: "42",
        username: "Scholar",
        accessToken: "plain-access-token",
        refreshToken: "plain-refresh-token",
        accessTokenExpiresAt: 1_700_000_100_000,
      },
      1_700_000_000_000,
    );
    const row = sessions.database
      .prepare("SELECT id_hash, access_token, refresh_token FROM auth_sessions")
      .get() as Record<string, string>;

    expect(row.id_hash).not.toBe(created.token);
    expect(row.access_token).not.toContain("plain-access-token");
    expect(row.refresh_token).not.toContain("plain-refresh-token");
    expect(sessions.get(created.token, 1_700_000_000_001)).toMatchObject({
      providerUserId: "42",
      username: "Scholar",
      accessToken: "plain-access-token",
      refreshToken: "plain-refresh-token",
    });
  });

  it("expires, cleans up, and deletes sessions", () => {
    const sessions = store();
    const now = 1_700_000_000_000;
    const first = sessions.create({
      providerUserId: "1",
      username: "One",
      accessToken: "access-one",
    }, now);
    const second = sessions.create({
      providerUserId: "2",
      username: "Two",
      accessToken: "access-two",
    }, now + 1);

    expect(sessions.get(first.token, now + SESSION_TTL_SECONDS * 1000)).toBeNull();
    expect(sessions.cleanupExpired(now + SESSION_TTL_SECONDS * 1000 + 1)).toBe(1);
    expect(sessions.get(second.token, now + SESSION_TTL_SECONDS * 1000 + 1)).toBeNull();

    const third = sessions.create({
      providerUserId: "3",
      username: "Three",
      accessToken: "access-three",
    }, now + SESSION_TTL_SECONDS * 1000 + 2);
    expect(sessions.delete(third.token)).toBe(true);
    expect(sessions.get(third.token)).toBeNull();
  });

  it("rotates encrypted provider tokens without changing the browser session", () => {
    const sessions = store();
    const now = 1_700_000_000_000;
    const created = sessions.create({
      providerUserId: "42",
      username: "Scholar",
      accessToken: "old-access",
      refreshToken: "old-refresh",
    }, now);

    expect(
      sessions.updateProviderTokens(
        created.token,
        { accessToken: "new-access", accessTokenExpiresAt: now + 60_000 },
        now + 1,
      ),
    ).toBe(true);
    expect(sessions.get(created.token, now + 2)).toMatchObject({
      accessToken: "new-access",
      refreshToken: "old-refresh",
      accessTokenExpiresAt: now + 60_000,
    });
  });

  it("revokes a prior session when the same FactGrid identity signs in again", () => {
    const sessions = store();
    const first = sessions.create({
      providerUserId: "42",
      username: "Scholar",
      accessToken: "first-access",
    });
    const second = sessions.create({
      providerUserId: "42",
      username: "Scholar",
      accessToken: "second-access",
    });

    expect(sessions.get(first.token)).toBeNull();
    expect(sessions.get(second.token)).toMatchObject({ accessToken: "second-access" });
  });

  it("creates the persistent database with owner-only permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "factgrid-session-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "sessions.sqlite");
    const sessions = SessionStore.open(path, "s".repeat(32));
    stores.push(sessions);

    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
  });
});
