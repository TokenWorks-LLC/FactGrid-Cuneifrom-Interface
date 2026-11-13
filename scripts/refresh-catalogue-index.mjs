/** Read-only, bounded/resumable discovery. No FactGrid write API is called. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const args = new Map();
for (let n = 2; n < process.argv.length; n += 2) args.set(process.argv[n], process.argv[n + 1]);
const classes = (args.get("--classes") || "").split(",").filter(Boolean).sort();
const policy = args.get("--policy");
if (!classes.length || classes.some((id) => !/^Q[1-9][0-9]{0,14}$/u.test(id)) || !policy || policy.length > 100) {
  throw new Error("Supply --classes Q512006 --policy clay-tablet-p2-p3-v1 matching the reviewed application policy.");
}
const batchSize = Number(args.get("--batch-size") || 500);
const maxBatches = Number(args.get("--max-batches") || 20);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000 ||
    !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10000) throw new Error("Invalid bounded scan limits");
const output = path.resolve(args.get("--output") || ".data/catalogue-index.json");
const checkpoint = `${output}.checkpoint`;
const prefix = `PREFIX wd: <https://database.factgrid.de/entity/>
PREFIX wdt: <https://database.factgrid.de/prop/direct/>
PREFIX p: <https://database.factgrid.de/prop/>
PREFIX ps: <https://database.factgrid.de/prop/statement/>
PREFIX pq: <https://database.factgrid.de/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>`;
const userAgent = "FactGrid-Cuneiform-Interface/0.1 (+https://github.com/TokenWorks-LLC/FactGrid-Cuneifrom-Interface)";
const metrics = { requests: 0, ms: 0, bytes: 0 };

async function request(url, accept, init = {}) {
  const start = Date.now();
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30000), headers: { ...init.headers, Accept: accept, "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`Read-only index request returned HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf8", { fatal: true });
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8_000_000) { await reader.cancel(); throw new Error("Index response exceeded 8 MB"); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  metrics.requests++; metrics.ms += Date.now() - start; metrics.bytes += bytes;
  return JSON.parse(text);
}

async function sparql(query) {
  const url = new URL("https://database.factgrid.de/sparql");
  const result = await request(url, "application/sparql-results+json", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ query: `${prefix}\n${query}` }),
  });
  if (!Array.isArray(result.results?.bindings)) throw new Error("Invalid SPARQL result");
  return result.results.bindings;
}

function qid(value) {
  const prefix = "https://database.factgrid.de/entity/";
  if (value?.type !== "uri" || !value.value?.startsWith(prefix) || !/^Q[1-9][0-9]{0,14}$/u.test(value.value.slice(prefix.length))) throw new Error("Invalid discovery entity URI");
  return value.value.slice(prefix.length);
}

async function atomicJson(filename, value) {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > 64_000_000) throw new Error("Catalogue artifact exceeds the loader's 64 MB limit; published index retained");
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, serialized, { flag: "wx" });
  await rename(temporary, filename);
}

await mkdir(path.dirname(output), { recursive: true });
const lockPath = `${output}.lock`;
let lockHandle;
try { lockHandle = openSync(lockPath, "wx"); }
catch (error) { if (error.code === "EEXIST") throw new Error(`Another refresh owns ${lockPath}. Verify the recorded process has exited before manually removing a stale lock.`); throw error; }
const lockToken = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token: randomUUID() });
writeFileSync(lockHandle, lockToken);
process.once("exit", () => {
  closeSync(lockHandle);
  try { if (readFileSync(lockPath, "utf8") === lockToken) unlinkSync(lockPath); } catch { /* A stale lock requires manual verification. */ }
});
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));
// Verify the complete subclass closure instead of silently omitting newly classified tablets.
const closure = (await sparql("SELECT DISTINCT ?class WHERE { ?class wdt:P3* wd:Q512006 } ORDER BY STR(?class) LIMIT 1001")).map((row) => qid(row.class)).sort();
if (closure.length > 1000 || JSON.stringify(closure) !== JSON.stringify(classes)) {
  throw new Error(`Classification closure changed (${closure.join(",")}); review eligibility policy before refreshing.`);
}
const membership = `VALUES ?class { ${classes.map((id) => `wd:${id}`).join(" ")} }
  ?item p:P2 ?classification . ?classification ps:P2 ?class ; wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)`;
async function sourceCount() {
  const rows = await sparql(`SELECT (COUNT(DISTINCT ?item) AS ?count) WHERE { ${membership} }`);
  const count = Number(rows[0]?.count?.value);
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) throw new Error("Invalid source count");
  return count;
}
let state = { version: 1, policy, classes, startedAt: new Date().toISOString(), after: "", sourceCount: 0, records: [], labels: {} };
const facetNames = ["collection", "findspot", "period", "language", "workType", "material"];
const qidPattern = /^Q[1-9][0-9]{0,14}$/u;
function validateState(value, complete = false) {
  if (!value || value.version !== 1 || value.policy !== policy || JSON.stringify(value.classes) !== JSON.stringify(classes) ||
      typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt)) ||
      !Array.isArray(value.records) || value.records.length > 1000000 || !value.labels || typeof value.labels !== "object" || Array.isArray(value.labels) ||
      !Number.isSafeInteger(value.sourceCount) || value.sourceCount < 1 || value.sourceCount > 1000000 || value.records.length > value.sourceCount) throw new Error("Incompatible or malformed checkpoint");
  let previous = "";
  for (const entry of value.records) {
    if (!entry || typeof entry.id !== "string" || !qidPattern.test(entry.id) || entry.id <= previous ||
        typeof entry.label !== "string" || entry.label.length > 10000 || typeof entry.terms !== "string" || entry.terms.length > 50000 ||
        facetNames.some((field) => !Array.isArray(entry[field]) || entry[field].length > 1000 || entry[field].some((id) => typeof id !== "string" || !qidPattern.test(id)))) throw new Error("Malformed checkpoint record or ordering");
    previous = entry.id;
  }
  for (const [id, label] of Object.entries(value.labels)) {
    if (!qidPattern.test(id) || typeof label !== "string" || label.length > 10000) throw new Error("Malformed checkpoint label");
  }
  if (value.facetAliases !== undefined) {
    if (!value.facetAliases || typeof value.facetAliases !== "object" || Array.isArray(value.facetAliases)) throw new Error("Malformed checkpoint aliases");
    for (const [id, aliases] of Object.entries(value.facetAliases)) {
      if (!qidPattern.test(id) || !Array.isArray(aliases) || aliases.length > 1000 || aliases.some((term) => typeof term !== "string" || term.length > 10000)) throw new Error("Malformed checkpoint aliases");
    }
  }
  if (complete) {
    if (value.complete !== true || value.records.length !== value.sourceCount || typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt)) || Date.parse(value.generatedAt) < Date.parse(value.startedAt)) throw new Error("Incomplete publication");
  } else if (typeof value.after !== "string" || value.after !== previous) throw new Error("Checkpoint boundary does not match its records");
}
try {
  const saved = JSON.parse(await readFile(checkpoint, "utf8"));
  validateState(saved);
  state = saved;
} catch (error) { if (error.code !== "ENOENT") throw error; }
if (!state.sourceCount) state.sourceCount = await sourceCount();
state.facetAliases ||= {};
state.metadataUpgradeCount ??= state.records.length;
state.metadataUpgradedCount ??= 0;
if (!Number.isSafeInteger(state.metadataUpgradeCount) || !Number.isSafeInteger(state.metadataUpgradedCount) || state.metadataUpgradedCount < 0 || state.metadataUpgradedCount > state.metadataUpgradeCount || state.metadataUpgradeCount > state.records.length) throw new Error("Invalid metadata migration checkpoint");

async function hydrateFacetLabels(ids) {
  for (let offset = 0; offset < ids.length; offset += 50) {
    const url = new URL("https://database.factgrid.de/w/api.php");
    const batch = ids.slice(offset, offset + 50);
    url.search = new URLSearchParams({ action: "wbgetentities", format: "json", formatversion: "2", props: "labels|aliases", ids: batch.join("|") });
    const result = await request(url, "application/json");
    if (result.error || !result.entities) throw new Error("Invalid facet label response");
    for (const id of batch) {
      const entity = result.entities[id];
      if (!entity) throw new Error("Provider omitted a facet entity");
      const labels = entity.labels || {};
      state.labels[id] = labels.en?.value || labels.de?.value || Object.keys(labels).sort().map((language) => labels[language]?.value).find(Boolean) || id;
      const aliases = [...Object.values(labels).map((term) => term.value), ...Object.values(entity.aliases || {}).flat().map((term) => term.value)];
      state.facetAliases[id] = [...new Set(aliases.filter((value) => typeof value === "string" && value !== state.labels[id]))];
      if (state.facetAliases[id].length > 1000 || state.facetAliases[id].some((value) => value.length > 10000)) throw new Error("Facet aliases exceed supported bounds");
    }
  }
}

async function hydrateRecordMetadata(ids) {
  const entries = new Map(ids.map((id) => [id, { id, label: id, terms: "", collection: [], findspot: [], period: [], language: [], workType: [], material: [] }]));
  const values = ids.map((id) => `wd:${id}`).join(" ");
  const aggregates = facetNames.map((field) => `(GROUP_CONCAT(DISTINCT IF(?property="${field}",STR(?value),"");separator="|") AS ?${field})`).join("\n");
  const metadata = await sparql(`SELECT ?item ${aggregates}
    (MIN(IF(?property="label",CONCAT(IF(LANG(?value)="en","0",IF(LANG(?value)="de","1","2"))," ",STR(?value)),"9")) AS ?labelCode)
    (GROUP_CONCAT(DISTINCT IF(?property="label" || ?property="identifier",STR(?value),"");separator=" ") AS ?terms)
    WHERE {
    VALUES ?item { ${values} }
    { ?item rdfs:label ?value . BIND("label" AS ?property) }
    UNION { ?item skos:altLabel ?value . BIND("identifier" AS ?property) }
    UNION { ?item p:P329 ?holding . ?holding pq:P10 ?value ; wikibase:rank ?holdingRank . FILTER(?holdingRank != wikibase:DeprecatedRank) BIND("identifier" AS ?property) }
    UNION {
      VALUES (?predicate ?valuePredicate ?property) {
        (p:P329 ps:P329 "collection") (p:P695 ps:P695 "findspot") (p:P853 ps:P853 "period")
        (p:P18 ps:P18 "language") (p:P121 ps:P121 "workType") (p:P401 ps:P401 "material")
        (p:P10 ps:P10 "identifier") (p:P11 ps:P11 "identifier") (p:P692 ps:P692 "identifier")
      }
      ?item ?predicate ?statement . ?statement ?valuePredicate ?value ; wikibase:rank ?rank .
      FILTER(?rank != wikibase:DeprecatedRank)
    }
  } GROUP BY ?item`);
  const seen = new Set();
  for (const row of metadata) {
    const id = qid(row.item);
    const entry = entries.get(id);
    if (!entry || seen.has(id) || typeof row.labelCode?.value !== "string" || typeof row.terms?.value !== "string") throw new Error("Invalid batch metadata");
    seen.add(id);
    entry.label = /^[012] /u.test(row.labelCode.value) ? row.labelCode.value.slice(2) : id;
    entry.terms = row.terms.value.trim();
    for (const field of facetNames) {
      if (typeof row[field]?.value !== "string") throw new Error("Invalid facet aggregate");
      entry[field] = row[field].value.split("|").filter(Boolean).map((value) => qid({ type: "uri", value }));
    }
  }
  for (const entry of entries.values()) {
    if (entry.label.length > 10000 || entry.terms.length > 50000) throw new Error("Oversized discovery terms");
  }
  return [...entries.values()];
}

for (let batch = 0; batch < maxBatches; batch++) {
  const keyset = state.after ? `FILTER(STR(?item) > "https://database.factgrid.de/entity/${state.after}")` : "";
  const rows = await sparql(`SELECT DISTINCT ?item WHERE {
    VALUES ?class { ${classes.map((id) => `wd:${id}`).join(" ")} }
    ?item p:P2 ?classification . ?classification ps:P2 ?class ; wikibase:rank ?rank .
    FILTER(?rank != wikibase:DeprecatedRank) ${keyset}
  } ORDER BY STR(?item) LIMIT ${batchSize}`);
  const ids = rows.map((row) => qid(row.item));
  if (ids.some((id, i) => id <= (i ? ids[i - 1] : state.after))) throw new Error("Provider did not preserve strict keyset ordering");
  if (!ids.length) {
    while (state.metadataUpgradedCount < state.metadataUpgradeCount) {
      if (batch >= maxBatches) {
        console.log(JSON.stringify({ status: "paused", checkpoint, instruction: "Run the same command to resume metadata migration." }));
        process.exit(0);
      }
      const end = Math.min(state.metadataUpgradedCount + batchSize, state.metadataUpgradeCount);
      const upgraded = await hydrateRecordMetadata(state.records.slice(state.metadataUpgradedCount, end).map((entry) => entry.id));
      state.records.splice(state.metadataUpgradedCount, upgraded.length, ...upgraded);
      state.metadataUpgradedCount = end;
      batch++;
      validateState(state);
      await atomicJson(checkpoint, state);
      console.log(JSON.stringify({ status: "metadata-upgrade", upgraded: end, total: state.metadataUpgradeCount }));
    }
    const allFacetIds = [...new Set(state.records.flatMap((entry) => facetNames.flatMap((field) => entry[field])))];
    await hydrateFacetLabels(allFacetIds.filter((id) => !Object.hasOwn(state.labels, id) || !Object.hasOwn(state.facetAliases, id)));
    const finalCount = await sourceCount();
    if (finalCount !== state.records.length || finalCount !== state.sourceCount) {
      throw new Error(`Source membership changed or scan incomplete (start ${state.sourceCount}, end ${finalCount}, scanned ${state.records.length}); retained published index. Archive checkpoint and restart.`);
    }
    let generatedAt = state.completedAt || new Date().toISOString();
    try {
      const previous = JSON.parse(await readFile(output, "utf8"));
      validateState(previous, true);
      if (previous.startedAt === state.startedAt) generatedAt = previous.generatedAt;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const index = { version: 1, policy, classes, startedAt: state.startedAt, generatedAt, complete: true, sourceCount: finalCount, records: state.records, labels: state.labels, facetAliases: state.facetAliases };
    validateState(index, true);
    await atomicJson(output, index);
    state.completedAt = generatedAt;
    await atomicJson(checkpoint, state);
    // Keep the exhausted checkpoint for auditing; archive it to begin a new full scan.
    console.log(JSON.stringify({ status: "complete", output, count: index.records.length, ...metrics }));
    process.exit(0);
  }
  const entries = new Map((await hydrateRecordMetadata(ids)).map((entry) => [entry.id, entry]));
  const newFacetIds = [...new Set([...entries.values()].flatMap((entry) => [...entry.collection, ...entry.findspot, ...entry.period, ...entry.language, ...entry.workType, ...entry.material]))].filter((id) => !Object.hasOwn(state.labels, id));
  await hydrateFacetLabels(newFacetIds);
  state.records.push(...entries.values());
  state.after = ids.at(-1);
  validateState(state);
  await atomicJson(checkpoint, state);
  console.log(JSON.stringify({ status: "checkpoint", count: state.records.length, after: state.after, ...metrics }));
}
console.log(JSON.stringify({ status: "paused", checkpoint, count: state.records.length, instruction: "Run the same command to resume; published index was not replaced.", ...metrics }));
