import type { AuthConfiguration } from "./config";
import { safeEqual } from "./crypto";

export function isSameOriginRequest(request: Request, appOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(appOrigin).origin && origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function hasValidCsrfToken(
  request: Request,
  expectedToken: string,
  headerName = "x-csrf-token",
): boolean {
  const suppliedToken = request.headers.get(headerName);
  return Boolean(suppliedToken && safeEqual(suppliedToken, expectedToken));
}

export function isApprovedEditor(
  username: string,
  configuration: Pick<AuthConfiguration, "allowedEditors" | "editingEnabled">,
): boolean {
  return configuration.editingEnabled && configuration.allowedEditors.has(username);
}
