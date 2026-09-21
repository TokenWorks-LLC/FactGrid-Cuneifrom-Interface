import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as proxyRequest } from "node:http";
import { createServer } from "node:https";
import { join } from "node:path";

const fixtureRoot = "/fixture/fixtures";
const tablet = JSON.parse(
  readFileSync(join(fixtureRoot, "entity-multiple-editions.json"), "utf8"),
).response.entities.Q9000002;
const revisions = JSON.parse(
  readFileSync(join(fixtureRoot, "document-revisions.json"), "utf8"),
);
const certificate = readFileSync("/fixture/server.crt");
const privateKey = readFileSync("/fixture/server.key");
const authorizationCodes = new Map();
let codeSequence = 0;

const labels = {
  Q102135: "centimetre",
  Q512006: "cuneiform tablet catalogue",
  Q9000100: "TEST FIXTURE collection",
  Q9000101: "TEST FIXTURE findspot",
  Q9000102: "TEST FIXTURE period",
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), {
    "content-type": "application/json; charset=utf-8",
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

async function readForm(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function handlePublicApi(url, response) {
  if (url.searchParams.get("list") === "search") {
    sendJson(response, 200, {
      batchcomplete: true,
      query: { search: [{ ns: 120, pageid: 9000002, title: "Item:Q9000002" }] },
    });
    return;
  }

  if (url.searchParams.get("action") === "wbgetentities") {
    const ids = (url.searchParams.get("ids") ?? "").split("|").filter(Boolean);
    sendJson(response, 200, {
      success: 1,
      entities: Object.fromEntries(ids.map((qid) => [qid, entity(qid)])),
    });
    return;
  }

  if (
    url.searchParams.get("action") === "query" &&
    url.searchParams.get("prop") === "revisions"
  ) {
    const requestedTitles = new Set((url.searchParams.get("titles") ?? "").split("|"));
    sendJson(response, 200, {
      ...revisions,
      query: {
        pages: revisions.query.pages.filter((page) => requestedTitles.has(page.title)),
      },
    });
    return;
  }

  sendJson(response, 400, { error: { code: "unexpected_fixture_request" } });
}

const server = createServer({ cert: certificate, key: privateKey }, async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "https://database.factgrid.de");

    if (request.method === "GET" && url.pathname === "/health") {
      send(response, 200, "ok", { "content-type": "text/plain; charset=utf-8" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/w/api.php") {
      handlePublicApi(url, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/w/rest.php/oauth2/authorize") {
      const callback = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      const challenge = url.searchParams.get("code_challenge");
      if (
        url.searchParams.get("response_type") !== "code" ||
        url.searchParams.get("client_id") !== "synthetic-client" ||
        callback !== "https://app.factgrid.test/api/auth/callback" ||
        !state ||
        !challenge ||
        url.searchParams.get("code_challenge_method") !== "S256"
      ) {
        sendJson(response, 400, { error: "invalid_request" });
        return;
      }

      const code = `synthetic-code-${++codeSequence}`;
      authorizationCodes.set(code, { callback, challenge });
      const location = new URL(callback);
      location.searchParams.set("code", code);
      location.searchParams.set("state", state);
      send(response, 302, "", { location: location.href });
      return;
    }

    if (request.method === "POST" && url.pathname === "/w/rest.php/oauth2/access_token") {
      const form = await readForm(request);
      const code = form.get("code");
      const transaction = code ? authorizationCodes.get(code) : null;
      const verifier = form.get("code_verifier") ?? "";
      const actualChallenge = createHash("sha256").update(verifier).digest("base64url");
      if (
        form.get("grant_type") !== "authorization_code" ||
        form.get("client_id") !== "synthetic-client" ||
        form.get("client_secret") !== "synthetic-client-secret" ||
        form.get("redirect_uri") !== transaction?.callback ||
        actualChallenge !== transaction?.challenge
      ) {
        sendJson(response, 400, { error: "invalid_grant" });
        return;
      }
      authorizationCodes.delete(code);
      sendJson(response, 200, {
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/w/rest.php/oauth2/resource/profile") {
      if (request.headers.authorization !== "Bearer synthetic-access-token") {
        sendJson(response, 401, { error: "invalid_token" });
        return;
      }
      sendJson(response, 200, {
        sub: "9001",
        username: "Docker Fixture Editor",
        blocked: false,
        groups: ["user"],
        rights: ["read", "edit"],
      });
      return;
    }

    sendJson(response, 404, { error: "not_found" });
  } catch {
    sendJson(response, 500, { error: "fixture_failure" });
  }
});

server.listen(443, "0.0.0.0");

const proxyServer = createServer({ cert: certificate, key: privateKey }, (request, response) => {
  const upstream = proxyRequest(
    {
      hostname: "app.factgrid.test",
      port: 3000,
      path: request.url,
      method: request.method,
      headers: {
        ...request.headers,
        connection: "close",
        host: "app.factgrid.test",
        "x-forwarded-host": "app.factgrid.test",
        "x-forwarded-proto": "https",
      },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) sendJson(response, 502, { error: "proxy_unavailable" });
    else response.destroy();
  });
  request.pipe(upstream);
});

proxyServer.listen(8443, "0.0.0.0");
