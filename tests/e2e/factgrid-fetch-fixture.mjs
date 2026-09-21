import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixtureRoot = join(process.cwd(), "tests", "fixtures", "factgrid");
const tablet = JSON.parse(
  readFileSync(join(fixtureRoot, "entity-multiple-editions.json"), "utf8"),
).response.entities.Q9000002;
const revisions = JSON.parse(
  readFileSync(join(fixtureRoot, "document-revisions.json"), "utf8"),
);
const originalFetch = globalThis.fetch.bind(globalThis);

const labels = {
  Q102135: "centimetre",
  Q512006: "cuneiform tablet catalogue",
  Q9000100: "TEST FIXTURE collection",
  Q9000101: "TEST FIXTURE findspot",
  Q9000102: "TEST FIXTURE period",
};
const relatedQids = new Set(Object.keys(labels));
const documentTitles = new Set([
  "D-Q9000002",
  "CDLI-W-Q9000002",
  "ORACC-W-Q9000002",
  "UNICODE-W-Q9000002",
  "Experimental-W-Q9000002",
]);

function assertParameters(url, expected) {
  const actualNames = [...url.searchParams.keys()].sort();
  const expectedNames = Object.keys(expected).sort();
  if (actualNames.join("|") !== expectedNames.join("|")) {
    throw new Error(`Unexpected FactGrid fixture parameters: ${actualNames.join(",")}`);
  }
  for (const [name, value] of Object.entries(expected)) {
    if (value !== undefined && url.searchParams.get(name) !== value) {
      throw new Error(`Unexpected ${name} in FactGrid fixture request.`);
    }
  }
}

function json(value) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status: 200,
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function entity(qid) {
  if (qid === "Q9000002") return tablet;
  return {
    id: qid,
    labels: { en: { language: "en", value: labels[qid] ?? qid } },
    descriptions: {},
    claims: {},
  };
}

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : undefined;
  const url = new URL(
    request ? request.url : input instanceof URL ? input.href : String(input),
  );
  if (url.origin !== "https://database.factgrid.de") return originalFetch(input, init);

  if (url.pathname !== "/w/api.php") {
    throw new Error(`Unexpected FactGrid fixture endpoint: ${url.pathname}`);
  }
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? request?.headers);
  if (method !== "GET" || headers.has("authorization")) {
    throw new Error("FactGrid acceptance fixtures permit only anonymous GET requests.");
  }

  if (url.searchParams.get("list") === "search") {
    const expression = url.searchParams.get("srsearch") ?? "";
    const allowedExpressions = new Set([
      'haswbstatement:P2=Q512006 "Prag" "I" "437"',
      'haswbstatement:P2=Q512006 haswbstatement:P329=Q9000100 "TEST" "FIXTURE"',
    ]);
    if (!allowedExpressions.has(expression)) {
      throw new Error("Unexpected catalogue search expression in acceptance fixture.");
    }
    assertParameters(url, {
      action: "query",
      format: "json",
      formatversion: "2",
      list: "search",
      srnamespace: "120",
      srsearch: expression,
      srprop: "",
      srlimit: "21",
      sroffset: "0",
      srsort: "create_timestamp_asc",
    });
    return json({
      batchcomplete: true,
      query: { search: [{ ns: 120, pageid: 9000002, title: "Item:Q9000002" }] },
    });
  }

  if (url.searchParams.get("action") === "wbgetentities") {
    const ids = (url.searchParams.get("ids") ?? "").split("|").filter(Boolean);
    const tabletRequest = ids.length === 1 && ids[0] === "Q9000002";
    const labelRequest = ids.length > 0 && ids.every((qid) => relatedQids.has(qid));
    if (!tabletRequest && !labelRequest) {
      throw new Error("Unexpected entity IDs in FactGrid acceptance fixture.");
    }
    assertParameters(url, {
      action: "wbgetentities",
      format: "json",
      formatversion: "2",
      props: "info|labels|descriptions|claims",
      languages: "en|de",
      languagefallback: "1",
      ids: ids.join("|"),
    });
    return json({
      success: 1,
      entities: Object.fromEntries(ids.map((qid) => [qid, entity(qid)])),
    });
  }

  if (
    url.searchParams.get("action") === "query" &&
    url.searchParams.get("prop") === "revisions"
  ) {
    const requestedTitles = new Set((url.searchParams.get("titles") ?? "").split("|"));
    if (
      requestedTitles.size !== documentTitles.size ||
      ![...documentTitles].every((title) => requestedTitles.has(title))
    ) {
      throw new Error("Unexpected document titles in FactGrid acceptance fixture.");
    }
    assertParameters(url, {
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "revisions",
      rvprop: "ids|timestamp|content|contentmodel",
      rvslots: "main",
      titles: [...requestedTitles].join("|"),
    });
    return json({
      ...revisions,
      query: {
        pages: revisions.query.pages.filter((page) => requestedTitles.has(page.title)),
      },
    });
  }

  throw new Error(`Unexpected FactGrid fixture request: ${url.toString()}`);
};
