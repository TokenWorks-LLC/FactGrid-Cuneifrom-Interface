import { beforeEach, describe, expect, it, vi } from "vitest";
import { TABLET_ELIGIBILITY_POLICY } from "./eligibility";

const fixture = {
  version: 1, policy: TABLET_ELIGIBILITY_POLICY, classes: ["Q512006"], complete: true,
  startedAt: "2026-11-13T00:00:00Z", generatedAt: "2026-11-13T01:00:00Z", sourceCount: 1,
  records: [{ id: "Q894483", label: "HS 751", terms: "HS 751", collection: [], findspot: [], period: [], language: [], workType: [], material: [] }], labels: {},
};

vi.mock("server-only", () => ({}));
const fs = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs/promises", () => fs);

describe("catalogue last-known-good loading", () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it("returns null when deployment has no index", async () => {
    fs.stat.mockRejectedValue(Object.assign(new Error("not found"), { code: "ENOENT" }));
    const { loadCatalogueIndex } = await import("./catalogue-index.server");
    expect(await loadCatalogueIndex()).toBeNull();
  });

  it("retains the valid index after a malformed refresh", async () => {
    fs.stat.mockResolvedValueOnce({ size: 100, mtimeMs: 1 }).mockResolvedValueOnce({ size: 100, mtimeMs: 2 });
    fs.readFile.mockResolvedValueOnce(JSON.stringify(fixture)).mockResolvedValueOnce('{"complete":false}');
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadCatalogueIndex } = await import("./catalogue-index.server");
    const previous = await loadCatalogueIndex();
    expect(previous?.records).toHaveLength(1);
    expect(await loadCatalogueIndex()).toBe(previous);
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
