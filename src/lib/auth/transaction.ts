import { OAUTH_TRANSACTION_TTL_SECONDS } from "./constants";
import { openString, sealString } from "./crypto";
import { sanitizeReturnPath } from "./config";

const TRANSACTION_PURPOSE = "oauth-transaction";

export interface OAuthTransaction {
  state: string;
  codeVerifier: string;
  returnTo: string;
  issuedAt: number;
}

export function sealOAuthTransaction(
  transaction: OAuthTransaction,
  secret: string,
): string {
  return sealString(JSON.stringify(transaction), secret, TRANSACTION_PURPOSE);
}

export function openOAuthTransaction(
  value: string,
  secret: string,
  now = Date.now(),
): OAuthTransaction | null {
  try {
    const parsed: unknown = JSON.parse(openString(value, secret, TRANSACTION_PURPOSE));
    if (!parsed || typeof parsed !== "object") return null;

    const transaction = parsed as Record<string, unknown>;
    if (
      typeof transaction.state !== "string" ||
      transaction.state.length < 32 ||
      typeof transaction.codeVerifier !== "string" ||
      transaction.codeVerifier.length < 43 ||
      typeof transaction.returnTo !== "string" ||
      typeof transaction.issuedAt !== "number" ||
      !Number.isSafeInteger(transaction.issuedAt)
    ) {
      return null;
    }

    const age = now - transaction.issuedAt;
    if (age < 0 || age > OAUTH_TRANSACTION_TTL_SECONDS * 1000) return null;

    return {
      state: transaction.state,
      codeVerifier: transaction.codeVerifier,
      returnTo: sanitizeReturnPath(transaction.returnTo),
      issuedAt: transaction.issuedAt,
    };
  } catch {
    return null;
  }
}
