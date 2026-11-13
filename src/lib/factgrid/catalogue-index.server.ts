import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseCatalogueIndex, type CatalogueIndex } from "./catalogue-index";

let lastGood: { path: string; signature: string; index: CatalogueIndex } | undefined;
let pending: Promise<CatalogueIndex | null> | undefined;

/** No network request or refresh runs in the visitor's request path. */
export async function loadCatalogueIndex(): Promise<CatalogueIndex | null> {
  if (pending) return pending;
  const filename = path.resolve(/* turbopackIgnore: true */ process.env.FACTGRID_CATALOGUE_INDEX || ".data/catalogue-index.json");
  pending = (async () => {
    try {
      const info = await stat(/* turbopackIgnore: true */ filename);
      if (info.size > 64_000_000) throw new Error("Catalogue index exceeds 64 MB");
      const signature = `${info.mtimeMs}:${info.size}`;
      if (lastGood?.path === filename && lastGood.signature === signature) return lastGood.index;
      const index = parseCatalogueIndex(JSON.parse(await readFile(/* turbopackIgnore: true */ filename, "utf8")));
      lastGood = { path: filename, signature, index };
      return index;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Catalogue index refresh unavailable; retaining the last valid index.");
      }
      return lastGood?.path === filename ? lastGood.index : null;
    }
  })();
  try { return await pending; } finally { pending = undefined; }
}
