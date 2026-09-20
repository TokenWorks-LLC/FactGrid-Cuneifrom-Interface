import { describe, expect, it } from "vitest";

import { openOAuthTransaction, sealOAuthTransaction } from "./transaction";

const secret = "s".repeat(32);
const issuedAt = 1_700_000_000_000;
const transaction = {
  state: "a".repeat(43),
  codeVerifier: "b".repeat(43),
  returnTo: "/tablets/Q499899",
  issuedAt,
};

describe("OAuth transaction cookie", () => {
  it("round trips an unexpired encrypted transaction", () => {
    const value = sealOAuthTransaction(transaction, secret);
    expect(value).not.toContain(transaction.state);
    expect(value).not.toContain(transaction.codeVerifier);
    expect(openOAuthTransaction(value, secret, issuedAt + 30_000)).toEqual(transaction);
  });

  it("rejects tampering, another secret, future issuance, and expiry", () => {
    const value = sealOAuthTransaction(transaction, secret);
    expect(openOAuthTransaction(`${value}x`, secret, issuedAt + 1)).toBeNull();
    expect(openOAuthTransaction(value, "z".repeat(32), issuedAt + 1)).toBeNull();
    expect(openOAuthTransaction(value, secret, issuedAt - 1)).toBeNull();
    expect(openOAuthTransaction(value, secret, issuedAt + 11 * 60 * 1000)).toBeNull();
  });
});
