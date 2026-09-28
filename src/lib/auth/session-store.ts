import Database from "better-sqlite3";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { OAUTH_TRANSACTION_TTL_SECONDS, SESSION_TTL_SECONDS } from "./constants";
import { sanitizeReturnPath } from "./config";
import { hashOpaqueToken, openString, randomOpaqueToken, sealString } from "./crypto";

export interface NewSession {
  oauthVersion?: "1.0a" | "2.0";
  providerUserId: string;
  username: string;
  accessToken: string;
  accessTokenSecret?: string | null;
  refreshToken?: string | null;
  accessTokenExpiresAt?: number | null;
}

export interface StoredSession {
  oauthVersion?: "1.0a" | "2.0";
  providerUserId: string;
  username: string;
  accessToken: string;
  accessTokenSecret?: string | null;
  refreshToken: string | null;
  accessTokenExpiresAt: number | null;
  expiresAt: number;
  csrfToken: string;
}

export type SessionSummary = Omit<StoredSession, "accessToken" | "accessTokenSecret" | "refreshToken">;

export interface OAuth1Transaction {
  requestToken: string;
  requestTokenSecret: string;
  returnTo: string;
  clientId: string;
  callbackUrl: string;
}

export interface CreatedSession extends StoredSession {
  token: string;
}

interface SessionRow {
  oauth_version: "1.0a" | "2.0";
  id_hash: string;
  provider_user_id: string;
  username: string;
  access_token: string;
  access_token_secret: string | null;
  refresh_token: string | null;
  access_token_expires_at: number | null;
  expires_at: number;
  csrf_token: string;
}

function tokenPurpose(kind: "access" | "access-secret" | "refresh", idHash: string): string {
  return `provider-${kind}-token:${idHash}`;
}

function prepareDatabase(path: string): Database.Database {
  let resolvedPath = path;
  if (path !== ":memory:") {
    resolvedPath = resolve(path);
    mkdirSync(dirname(resolvedPath), { recursive: true, mode: 0o700 });
    const descriptor = openSync(resolvedPath, "a", 0o600);
    closeSync(descriptor);
    chmodSync(resolvedPath, 0o600);
  }
  const database = new Database(resolvedPath);
  database.pragma("busy_timeout = 5000");
  database.pragma("journal_mode = WAL");
  return database;
}

export class SessionStore {
  readonly database: Database.Database;
  readonly secret: string;

  constructor(database: Database.Database, secret: string) {
    this.database = database;
    this.secret = secret;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id_hash TEXT PRIMARY KEY,
        provider_user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        access_token_expires_at INTEGER,
        expires_at INTEGER NOT NULL,
        csrf_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_expires_at
        ON auth_sessions (expires_at);
      CREATE TABLE IF NOT EXISTS auth_oauth1_transactions (
        id_hash TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_oauth1_transactions_expires_at
        ON auth_oauth1_transactions (expires_at);
    `);
    // Preserve existing OAuth 2 sessions when upgrading the persistent volume.
    const columns = this.database.pragma("table_info(auth_sessions)") as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "oauth_version")) {
      this.database.exec("ALTER TABLE auth_sessions ADD COLUMN oauth_version TEXT NOT NULL DEFAULT '2.0'");
    }
    if (!columns.some((column) => column.name === "access_token_secret")) {
      this.database.exec("ALTER TABLE auth_sessions ADD COLUMN access_token_secret TEXT");
    }
  }

  static open(path: string, secret: string): SessionStore {
    return new SessionStore(prepareDatabase(path), secret);
  }

  create(input: NewSession, now = Date.now()): CreatedSession {
    if (input.oauthVersion === "1.0a" && !input.accessTokenSecret) {
      throw new Error("An OAuth 1.0a session requires a token secret");
    }
    this.cleanupExpired(now);
    // One active application session per FactGrid identity limits session-table
    // growth and makes a fresh login revoke the prior browser session.
    this.database
      .prepare("DELETE FROM auth_sessions WHERE provider_user_id = ?")
      .run(input.providerUserId);
    const activeSessions = this.database
      .prepare("SELECT COUNT(*) AS count FROM auth_sessions")
      .get() as { count: number };
    if (activeSessions.count >= 10_000) {
      throw new Error("The active session limit has been reached");
    }

    const token = randomOpaqueToken();
    const idHash = hashOpaqueToken(token);
    const expiresAt = now + SESSION_TTL_SECONDS * 1000;
    const csrfToken = randomOpaqueToken();
    const accessToken = sealString(
      input.accessToken,
      this.secret,
      tokenPurpose("access", idHash),
    );
    const refreshToken = input.refreshToken
      ? sealString(input.refreshToken, this.secret, tokenPurpose("refresh", idHash))
      : null;
    const accessTokenSecret = input.accessTokenSecret
      ? sealString(input.accessTokenSecret, this.secret, tokenPurpose("access-secret", idHash))
      : null;

    this.database
      .prepare(
        `INSERT INTO auth_sessions (
          id_hash, provider_user_id, username, access_token, refresh_token,
          access_token_expires_at, expires_at, csrf_token, created_at, updated_at,
          oauth_version, access_token_secret
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        idHash,
        input.providerUserId,
        input.username,
        accessToken,
        refreshToken,
        input.accessTokenExpiresAt ?? null,
        expiresAt,
        csrfToken,
        now,
        now,
        input.oauthVersion ?? "2.0",
        accessTokenSecret,
      );

    return {
      ...input,
      oauthVersion: input.oauthVersion ?? "2.0",
      accessTokenSecret: input.accessTokenSecret ?? null,
      refreshToken: input.refreshToken ?? null,
      accessTokenExpiresAt: input.accessTokenExpiresAt ?? null,
      token,
      expiresAt,
      csrfToken,
    };
  }

  get(token: string | null | undefined, now = Date.now()): StoredSession | null {
    const resolved = this.resolveRow(token, now);
    if (!resolved) return null;
    const { idHash, row } = resolved;

    try {
      return {
        oauthVersion: row.oauth_version,
        providerUserId: row.provider_user_id,
        username: row.username,
        accessToken: openString(
          row.access_token,
          this.secret,
          tokenPurpose("access", idHash),
        ),
        accessTokenSecret: row.access_token_secret
          ? openString(row.access_token_secret, this.secret, tokenPurpose("access-secret", idHash))
          : null,
        refreshToken: row.refresh_token
          ? openString(
              row.refresh_token,
              this.secret,
              tokenPurpose("refresh", idHash),
            )
          : null,
        accessTokenExpiresAt: row.access_token_expires_at,
        expiresAt: row.expires_at,
        csrfToken: row.csrf_token,
      };
    } catch {
      this.database.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(idHash);
      return null;
    }
  }

  getSummary(
    token: string | null | undefined,
    now = Date.now(),
  ): SessionSummary | null {
    const resolved = this.resolveRow(token, now);
    if (!resolved) return null;
    return {
      oauthVersion: resolved.row.oauth_version,
      providerUserId: resolved.row.provider_user_id,
      username: resolved.row.username,
      accessTokenExpiresAt: resolved.row.access_token_expires_at,
      expiresAt: resolved.row.expires_at,
      csrfToken: resolved.row.csrf_token,
    };
  }

  private resolveRow(
    token: string | null | undefined,
    now: number,
  ): { idHash: string; row: SessionRow } | null {
    if (!token || token.length > 256) return null;
    const idHash = hashOpaqueToken(token);
    const row = this.database
      .prepare("SELECT * FROM auth_sessions WHERE id_hash = ?")
      .get(idHash) as SessionRow | undefined;

    if (!row) return null;
    if (row.expires_at <= now) {
      this.database.prepare("DELETE FROM auth_sessions WHERE id_hash = ?").run(idHash);
      return null;
    }
    return { idHash, row };
  }

  updateProviderTokens(
    token: string,
    values: {
      accessToken: string;
      refreshToken?: string | null;
      accessTokenExpiresAt?: number | null;
    },
    now = Date.now(),
  ): boolean {
    const idHash = hashOpaqueToken(token);
    const current = this.database
      .prepare("SELECT refresh_token FROM auth_sessions WHERE id_hash = ? AND expires_at > ?")
      .get(idHash, now) as Pick<SessionRow, "refresh_token"> | undefined;
    if (!current) return false;

    const accessToken = sealString(
      values.accessToken,
      this.secret,
      tokenPurpose("access", idHash),
    );
    const refreshToken =
      values.refreshToken === undefined
        ? current.refresh_token
        : values.refreshToken
          ? sealString(values.refreshToken, this.secret, tokenPurpose("refresh", idHash))
          : null;

    const result = this.database
      .prepare(
        `UPDATE auth_sessions
         SET access_token = ?, refresh_token = ?, access_token_expires_at = ?, updated_at = ?
         WHERE id_hash = ? AND expires_at > ?`,
      )
      .run(
        accessToken,
        refreshToken,
        values.accessTokenExpiresAt ?? null,
        now,
        idHash,
        now,
      );
    return result.changes === 1;
  }

  delete(token: string | null | undefined): boolean {
    if (!token || token.length > 256) return false;
    return (
      this.database
        .prepare("DELETE FROM auth_sessions WHERE id_hash = ?")
        .run(hashOpaqueToken(token)).changes === 1
    );
  }

  cleanupExpired(now = Date.now()): number {
    this.database.prepare("DELETE FROM auth_oauth1_transactions WHERE expires_at <= ?").run(now);
    return this.database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now)
      .changes;
  }

  createOAuth1Transaction(input: OAuth1Transaction, now = Date.now()): string {
    this.cleanupExpired(now);
    const { count } = this.database.prepare("SELECT COUNT(*) AS count FROM auth_oauth1_transactions")
      .get() as { count: number };
    if (count >= 10_000) throw new Error("The sign-in transaction limit has been reached");
    const browserToken = randomOpaqueToken();
    const idHash = hashOpaqueToken(browserToken);
    const payload = sealString(JSON.stringify(input), this.secret, `oauth1-transaction:${idHash}`);
    this.database.prepare(
      "INSERT INTO auth_oauth1_transactions (id_hash, payload, expires_at) VALUES (?, ?, ?)",
    ).run(idHash, payload, now + OAUTH_TRANSACTION_TTL_SECONDS * 1000);
    return browserToken;
  }

  consumeOAuth1Transaction(token: string | undefined, now = Date.now()): OAuth1Transaction | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const idHash = hashOpaqueToken(token);
    // Atomic DELETE RETURNING makes a replay fail even if the original browser
    // cookie is copied, or two callbacks arrive concurrently.
    const row = this.database.prepare(
      "DELETE FROM auth_oauth1_transactions WHERE id_hash = ? RETURNING payload, expires_at",
    ).get(idHash) as { payload: string; expires_at: number } | undefined;
    if (!row || row.expires_at <= now) return null;
    try {
      const value = JSON.parse(openString(row.payload, this.secret, `oauth1-transaction:${idHash}`));
      if (!value || typeof value !== "object" ||
        ["requestToken", "requestTokenSecret", "returnTo", "clientId", "callbackUrl"]
          .some((field) => typeof value[field] !== "string" || !value[field])) return null;
      return { ...value, returnTo: sanitizeReturnPath(value.returnTo) };
    } catch {
      return null;
    }
  }

  close(): void {
    this.database.close();
  }
}
