import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
const requestTokens = new Map();
const usedNonces = new Set();
const oauth1Audit = { initiate: 0, token: 0, identify: 0 };
let requestTokenSequence = 0;
const consumerKey = "synthetic-consumer";
const consumerSecret = "synthetic-consumer-secret";
const accessToken = "synthetic-access-token";
const accessSecret = "synthetic-access-secret/%+=";
const callbackUrl = "https://app.factgrid.test/api/auth/callback";

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

// This fixture deliberately does not import the application's OAuth library.
// Verify the wire signature independently, including URL and form parameters.
function percentEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function verifyOAuth1(request, url, expectedToken, tokenSecret = "", form = new URLSearchParams()) {
  const header = request.headers.authorization ?? "";
  if (!header.startsWith("OAuth ")) throw new Error("OAuth header is required");
  const oauth = new Map();
  for (const component of header.slice(6).split(/,\s*/u)) {
    const match = component.trim().match(/^([A-Za-z_]+)="([^"\\]*)"$/u);
    if (!match) throw new Error("Malformed OAuth header");
    const key = decodeURIComponent(match[1]);
    if (oauth.has(key)) throw new Error("Duplicate OAuth parameter");
    oauth.set(key, decodeURIComponent(match[2]));
  }
  const nonce = oauth.get("oauth_nonce");
  const timestamp = oauth.get("oauth_timestamp") ?? "";
  if (
    oauth.get("oauth_consumer_key") !== consumerKey ||
    oauth.get("oauth_signature_method") !== "HMAC-SHA1" ||
    (oauth.has("oauth_version") && oauth.get("oauth_version") !== "1.0") ||
    (oauth.get("oauth_token") ?? null) !== expectedToken ||
    !nonce ||
    !/^\d+$/u.test(timestamp) ||
    Math.abs(Number(timestamp) - Math.floor(Date.now() / 1_000)) > 300
  ) {
    throw new Error("Invalid OAuth parameters");
  }
  const parameters = [
    ...url.searchParams,
    ...form,
    ...[...oauth].filter(([name]) => name !== "oauth_signature" && name !== "realm"),
  ].map(([name, value]) => [percentEncode(name), percentEncode(value)]);
  parameters.sort(([leftName, leftValue], [rightName, rightValue]) =>
    leftName === rightName
      ? (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0)
      : (leftName < rightName ? -1 : 1),
  );
  const normalized = parameters.map(([name, value]) => `${name}=${value}`).join("&");
  const base = [request.method, `${url.origin}${url.pathname}`, normalized].map(percentEncode).join("&");
  const expected = createHmac("sha1", `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`)
    .update(base)
    .digest("base64");
  const supplied = oauth.get("oauth_signature") ?? "";
  if (
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  ) {
    throw new Error("Invalid OAuth signature");
  }
  const nonceKey = `${expectedToken ?? ""}|${timestamp}|${nonce}`;
  if (usedNonces.has(nonceKey)) throw new Error("Replayed OAuth nonce");
  usedNonces.add(nonceKey);
  return oauth;
}

function signedIdentity(nonce) {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    // MediaWiki's UserStatementProvider uses CanonicalServer, including HTTPS.
    iss: "https://database.factgrid.de",
    aud: consumerKey,
    nonce,
    iat: now,
    exp: now + 100,
    sub: "9001",
    username: "Docker Fixture Editor",
    blocked: false,
    groups: ["user"],
    rights: ["read", "edit"],
  })).toString("base64url");
  const signature = createHmac("sha256", consumerSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function handleOAuth1(request, url, response) {
  const endpoint = url.searchParams.get("title");
  try {
    if (endpoint === "Special:OAuth/initiate") {
      verifyOAuth1(request, url, null);
      if (url.searchParams.get("oauth_callback") !== "oob") throw new Error("Expected exact registered callback");
      const key = `synthetic-request-token-${++requestTokenSequence}`;
      const secret = `synthetic-request-secret/${requestTokenSequence}%+=`;
      requestTokens.set(key, { secret, authorized: false, verifier: null });
      oauth1Audit.initiate += 1;
      sendJson(response, 200, { key, secret });
      return;
    }
    if (endpoint === "Special:OAuth/token") {
      const token = /(?:^|,\s*)oauth_token="([^"]+)"/u.exec((request.headers.authorization ?? "").slice(6));
      const key = token ? decodeURIComponent(token[1]) : "";
      const transaction = requestTokens.get(key);
      if (!transaction || !transaction.authorized) throw new Error("Unknown request token");
      verifyOAuth1(request, url, key, transaction.secret);
      if (url.searchParams.get("oauth_verifier") !== transaction.verifier) throw new Error("Invalid verifier");
      requestTokens.delete(key);
      oauth1Audit.token += 1;
      sendJson(response, 200, { key: accessToken, secret: accessSecret });
      return;
    }
    if (endpoint === "Special:OAuth/identify") {
      const oauth = verifyOAuth1(request, url, accessToken, accessSecret);
      oauth1Audit.identify += 1;
      send(response, 200, signedIdentity(oauth.get("oauth_nonce")), { "content-type": "application/jwt" });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch {
    sendJson(response, 401, { error: "invalid_oauth1_request" });
  }
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

    if (request.method === "GET" && url.pathname === "/fixture/oauth1-audit") {
      sendJson(response, 200, oauth1Audit);
      return;
    }

    if (request.method === "GET" && url.pathname === "/w/index.php") {
      handleOAuth1(request, url, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/wiki/Special:OAuth/authorize") {
      const key = url.searchParams.get("oauth_token");
      const transaction = key ? requestTokens.get(key) : null;
      if (url.searchParams.get("oauth_consumer_key") !== consumerKey || !transaction || transaction.authorized) {
        sendJson(response, 400, { error: "invalid_request_token" });
        return;
      }
      transaction.authorized = true;
      transaction.verifier = `synthetic-verifier-${requestTokenSequence}`;
      const location = new URL(callbackUrl);
      location.searchParams.set("oauth_token", key);
      location.searchParams.set("oauth_verifier", transaction.verifier);
      send(response, 302, "", { location: location.href });
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
