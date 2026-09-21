import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";

import type { AuthConfiguration } from "./config";
import {
  OAUTH_TRANSACTION_COOKIE_NAME,
  OAUTH_TRANSACTION_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "./constants";
import { SessionStore, type SessionSummary } from "./session-store";

const authGlobal = globalThis as typeof globalThis & {
  __factGridSessionStores?: Map<string, SessionStore>;
};
const stores = (authGlobal.__factGridSessionStores ??= new Map<string, SessionStore>());

function storeKey(configuration: AuthConfiguration): string {
  const secretFingerprint = createHash("sha256")
    .update(configuration.sessionSecret, "utf8")
    .digest("base64url");
  return `${configuration.sessionDbPath}\0${secretFingerprint}`;
}

export function getSessionStore(configuration: AuthConfiguration): SessionStore {
  const key = storeKey(configuration);
  const existing = stores.get(key);
  if (existing) return existing;

  const store = SessionStore.open(
    configuration.sessionDbPath,
    configuration.sessionSecret,
  );
  stores.set(key, store);
  return store;
}

export function readSession(
  request: NextRequest,
  configuration: AuthConfiguration,
): SessionSummary | null {
  return getSessionStore(configuration).getSummary(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
}

export function readSessionToken(request: NextRequest): string | null {
  return request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: number,
  configuration: AuthConfiguration,
): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: configuration.secureCookies,
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
    maxAge: SESSION_TTL_SECONDS,
    priority: "high",
  });
}

export function clearSessionCookie(
  response: NextResponse,
  configuration: Pick<AuthConfiguration, "secureCookies">,
): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: configuration.secureCookies,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
    priority: "high",
  });
}

export function setOAuthTransactionCookie(
  response: NextResponse,
  value: string,
  configuration: AuthConfiguration,
): void {
  response.cookies.set(OAUTH_TRANSACTION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: configuration.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_TRANSACTION_TTL_SECONDS,
    priority: "high",
  });
}

export function clearOAuthTransactionCookie(
  response: NextResponse,
  configuration: AuthConfiguration,
): void {
  response.cookies.set(OAUTH_TRANSACTION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: configuration.secureCookies,
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
    priority: "high",
  });
}
