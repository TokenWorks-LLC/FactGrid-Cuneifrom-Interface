import {
  AUTH_CALLBACK_PATH,
  FACTGRID_OAUTH_AUTHORIZE_URL,
  FACTGRID_OAUTH_ISSUER,
  FACTGRID_OAUTH_PROFILE_URL,
  FACTGRID_OAUTH_TOKEN_URL,
} from "./constants";

export interface AuthConfiguration {
  appOrigin: string;
  callbackUrl: string;
  clientId: string;
  clientSecret: string;
  sessionDbPath: string;
  sessionSecret: string;
  secureCookies: boolean;
  editingEnabled: boolean;
  allowedEditors: ReadonlySet<string>;
  oauth: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    profileEndpoint: string;
  };
}

export type AuthConfigurationResult =
  | { available: true; config: AuthConfiguration }
  | { available: false; missing: string[]; invalid: string[] };

type Environment = Partial<Record<string, string | undefined>>;

const REQUIRED_ENVIRONMENT = [
  "APP_ORIGIN",
  "FACTGRID_OAUTH_CALLBACK_URL",
  "FACTGRID_OAUTH_CLIENT_ID",
  "FACTGRID_OAUTH_CLIENT_SECRET",
  "FACTGRID_SESSION_DB_PATH",
  "SESSION_SECRET",
] as const;

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isSafeApplicationUrl(url: URL, production: boolean): boolean {
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return !production && url.protocol === "http:" && isLoopback(url.hostname);
}

export function parseAllowedEditors(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((username) => username.trim())
      .filter(Boolean),
  );
}

export function getAuthConfiguration(
  env: Environment = process.env,
): AuthConfigurationResult {
  const missing = REQUIRED_ENVIRONMENT.filter((name) => !env[name]?.trim());
  const invalid: string[] = [];

  if (missing.length > 0) {
    return { available: false, missing: [...missing], invalid };
  }

  const appOriginUrl = parseUrl(env.APP_ORIGIN!.trim());
  const callbackUrl = parseUrl(env.FACTGRID_OAUTH_CALLBACK_URL!.trim());
  const production = env.NODE_ENV === "production";

  if (
    !appOriginUrl ||
    !isSafeApplicationUrl(appOriginUrl, production) ||
    appOriginUrl.pathname !== "/" ||
    appOriginUrl.search ||
    appOriginUrl.hash
  ) {
    invalid.push("APP_ORIGIN");
  }

  if (
    !callbackUrl ||
    !isSafeApplicationUrl(callbackUrl, production) ||
    callbackUrl.pathname !== AUTH_CALLBACK_PATH ||
    callbackUrl.search ||
    callbackUrl.hash
  ) {
    invalid.push("FACTGRID_OAUTH_CALLBACK_URL");
  }

  if (appOriginUrl && callbackUrl && callbackUrl.origin !== appOriginUrl.origin) {
    invalid.push("FACTGRID_OAUTH_CALLBACK_URL");
  }

  if (Buffer.byteLength(env.SESSION_SECRET!, "utf8") < 32) {
    invalid.push("SESSION_SECRET");
  }

  if (invalid.length > 0 || !appOriginUrl || !callbackUrl) {
    return { available: false, missing: [], invalid: [...new Set(invalid)] };
  }

  return {
    available: true,
    config: {
      appOrigin: appOriginUrl.origin,
      callbackUrl: callbackUrl.href,
      clientId: env.FACTGRID_OAUTH_CLIENT_ID!,
      clientSecret: env.FACTGRID_OAUTH_CLIENT_SECRET!,
      sessionDbPath: env.FACTGRID_SESSION_DB_PATH!,
      sessionSecret: env.SESSION_SECRET!,
      secureCookies: production,
      editingEnabled: env.FACTGRID_EDITING_ENABLED === "true",
      allowedEditors: parseAllowedEditors(env.FACTGRID_ALLOWED_EDITORS),
      oauth: {
        issuer: FACTGRID_OAUTH_ISSUER,
        authorizationEndpoint: FACTGRID_OAUTH_AUTHORIZE_URL,
        tokenEndpoint: FACTGRID_OAUTH_TOKEN_URL,
        profileEndpoint: FACTGRID_OAUTH_PROFILE_URL,
      },
    },
  };
}

export function sanitizeReturnPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (value.length > 2_048) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return "/";

  try {
    const parsed = new URL(value, "https://local.invalid");
    if (parsed.origin !== "https://local.invalid") return "/";
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return normalized.length <= 2_048 ? normalized : "/";
  } catch {
    return "/";
  }
}
