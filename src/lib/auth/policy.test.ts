import { describe, expect, it } from "vitest";

import { hasValidCsrfToken, isApprovedEditor, isSameOriginRequest } from "./policy";

describe("mutation policy", () => {
  it("requires the exact application origin", () => {
    const matching = new Request("https://interface.example/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://interface.example" },
    });
    const missing = new Request("https://interface.example/api/auth/logout", {
      method: "POST",
    });
    const foreign = new Request("https://interface.example/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });

    expect(isSameOriginRequest(matching, "https://interface.example")).toBe(true);
    expect(isSameOriginRequest(missing, "https://interface.example")).toBe(false);
    expect(isSameOriginRequest(foreign, "https://interface.example")).toBe(false);
  });

  it("compares application CSRF tokens exactly", () => {
    const valid = new Request("https://interface.example/api/write", {
      headers: { "x-csrf-token": "csrf-value" },
    });
    const invalid = new Request("https://interface.example/api/write", {
      headers: { "x-csrf-token": "csrf-valuE" },
    });
    expect(hasValidCsrfToken(valid, "csrf-value")).toBe(true);
    expect(hasValidCsrfToken(invalid, "csrf-value")).toBe(false);
  });
});

describe("editor allowlist", () => {
  const configuration = {
    editingEnabled: true,
    allowedEditors: new Set(["Exact Username"]),
  };

  it("requires both the deployment switch and an exact username", () => {
    expect(isApprovedEditor("Exact Username", configuration)).toBe(true);
    expect(isApprovedEditor("exact username", configuration)).toBe(false);
    expect(
      isApprovedEditor("Exact Username", { ...configuration, editingEnabled: false }),
    ).toBe(false);
  });
});
