import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCatalogueIndex } from "./catalogue-index";

const script = path.resolve("scripts/refresh-catalogue-index.mjs");
const preload = pathToFileURL(path.resolve("tests/fixtures/catalogue-provider.mjs")).href;
function temporaryTask(run: (output: string) => void) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "factgrid-catalogue-"));
  try { run(path.join(directory, "index.json")); }
  finally {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("factgrid-catalogue-")) throw new Error("Unsafe cleanup target");
    rmSync(resolved, { recursive: true, force: true });
  }
}
const args = (output: string, max = "1") => ["--import", preload, script, "--classes", "Q512006", "--policy", "clay-tablet-p2-p3-v1", "--output", output, "--batch-size", "1", "--max-batches", max];
const execute = (output: string, max = "1") => execFileSync(process.execPath, args(output, max), { encoding: "utf8", windowsHide: true });

describe("bounded recoverable catalogue refresh", () => {
  it("resumes checkpoints, publishes only after exhaustion, and preserves freshness on rerun", () => temporaryTask((output) => {
    expect(execute(output)).toContain('"count":1');
    expect(existsSync(output)).toBe(false);
    const fail = spawnSync(process.execPath, args(output), { env: { ...process.env, CATALOGUE_TEST_FAIL: "metadata" }, encoding: "utf8", windowsHide: true });
    expect(fail.status).not.toBe(0);
    expect(JSON.parse(readFileSync(`${output}.checkpoint`, "utf8")).records).toHaveLength(1);
    expect(existsSync(output)).toBe(false);
    execute(output, "10");
    const index = parseCatalogueIndex(JSON.parse(readFileSync(output, "utf8")));
    expect(index.records).toHaveLength(2);
    expect(index.records[0].terms).toContain("qualifier inventory HS 751");
    expect(index.facetAliases?.Q900).toContain("University of Jena");
    execute(output, "10");
    expect(JSON.parse(readFileSync(output, "utf8")).generatedAt).toBe(index.generatedAt);
    expect(existsSync(`${output}.lock`)).toBe(false);
  }));

  it("rejects a concurrent writer and malformed checkpoints without replacing the published index", () => temporaryTask((output) => {
    execute(output, "10");
    const previous = readFileSync(output, "utf8");
    writeFileSync(`${output}.lock`, "operator test lock");
    const locked = spawnSync(process.execPath, args(output), { encoding: "utf8", windowsHide: true });
    expect(locked.status).not.toBe(0);
    expect(locked.stderr).toContain("Another refresh owns");
    expect(readFileSync(output, "utf8")).toBe(previous);
    rmSync(`${output}.lock`);
    const checkpoint = JSON.parse(readFileSync(`${output}.checkpoint`, "utf8"));
    checkpoint.records[1].id = checkpoint.records[0].id;
    writeFileSync(`${output}.checkpoint`, JSON.stringify(checkpoint));
    const corrupt = spawnSync(process.execPath, args(output), { encoding: "utf8", windowsHide: true });
    expect(corrupt.status).not.toBe(0);
    expect(readFileSync(output, "utf8")).toBe(previous);
  }));

  it("makes progress migrating an exhausted legacy checkpoint with a one-batch budget", () => temporaryTask((output) => {
    execute(output, "10");
    const previous = JSON.parse(readFileSync(output, "utf8"));
    const checkpoint = JSON.parse(readFileSync(`${output}.checkpoint`, "utf8"));
    delete checkpoint.metadataUpgradeCount;
    delete checkpoint.metadataUpgradedCount;
    checkpoint.records.forEach((entry: { terms: string }) => { entry.terms = "legacy terms"; });
    writeFileSync(`${output}.checkpoint`, JSON.stringify(checkpoint));
    execute(output);
    const halfway = JSON.parse(readFileSync(`${output}.checkpoint`, "utf8"));
    expect(halfway.metadataUpgradedCount).toBe(1);
    expect(halfway.records[0].terms).toContain("qualifier inventory");
    execute(output);
    const migrated = parseCatalogueIndex(JSON.parse(readFileSync(output, "utf8")));
    expect(migrated.generatedAt).toBe(previous.generatedAt);
    expect(migrated.records.every((entry) => entry.terms.includes("qualifier inventory"))).toBe(true);
  }));
});
