import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const suffix = `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const prefix = `factgrid-task-${suffix}`;
const names = {
  app: `${prefix}-app`,
  appImage: `${prefix}-app-image`,
  certVolume: `${prefix}-certs`,
  checker: `${prefix}-checker`,
  dataVolume: `${prefix}-data`,
  network: `${prefix}-network`,
  provider: `${prefix}-provider`,
  providerImage: `${prefix}-provider-image`,
};
const temporaryDirectory = mkdtempSync(join(tmpdir(), `${prefix}-`));
const sessionSecret = "docker-smoke-session-secret-32-bytes-minimum";
const forwardedHeaders = {
  host: "app.factgrid.test",
  "x-forwarded-host": "app.factgrid.test",
  "x-forwarded-proto": "https",
};

function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    timeout: options.timeout ?? 10 * 60 * 1000,
  });
  if (result.error) {
    if (options.allowFailure) return "";
    throw result.error;
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `Docker command failed with status ${result.status}: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
  return (result.stdout ?? "").trim();
}

function log(step) {
  process.stdout.write(`\n[docker-smoke] ${step}\n`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForHealthy(container, timeoutMilliseconds = 90_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const state = docker(
      ["inspect", "--format", "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}", container],
      { capture: true, allowFailure: true },
    );
    if (state === "running|healthy") return;
    if (state.startsWith("exited|") || state.startsWith("dead|")) {
      throw new Error(`Container ${container} stopped before becoming healthy.`);
    }
    await sleep(1_000);
  }
  throw new Error(`Container ${container} did not become healthy within the smoke-test deadline.`);
}

function publishedPort(container, containerPort) {
  const mapping = docker(["port", container, `${containerPort}/tcp`], { capture: true });
  const match = mapping.match(/127\.0\.0\.1:(\d+)/u);
  if (!match) throw new Error(`Could not resolve the published port for ${container}.`);
  return Number(match[1]);
}

function request({ port, path = "/", method = "GET", headers = {}, body, tls }) {
  return new Promise((resolve, reject) => {
    const transport = tls ? httpsRequest : httpRequest;
    const requestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers,
      timeout: 15_000,
      ...(tls ? { ca: tls.ca, servername: tls.servername } : {}),
    };
    const outgoing = transport(requestOptions, (incoming) => {
      const chunks = [];
      let size = 0;
      incoming.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          outgoing.destroy(new Error("Smoke-test response exceeded 2 MiB."));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("end", () => {
        resolve({
          status: incoming.statusCode,
          headers: incoming.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    outgoing.on("timeout", () => outgoing.destroy(new Error("Smoke-test request timed out.")));
    outgoing.on("error", reject);
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

function cookie(setCookie, name) {
  const header = (setCookie ?? []).find((value) => value.startsWith(`${name}=`));
  assert.ok(header, `Expected the ${name} cookie.`);
  return { header, pair: header.split(";", 1)[0] };
}

function assertPrivate(response) {
  assert.match(response.headers["cache-control"] ?? "", /private/u);
  assert.match(response.headers["cache-control"] ?? "", /no-store/u);
  assert.equal(response.headers.pragma, "no-cache");
  assert.match(response.headers.vary ?? "", /Cookie/u);
}

function assertSecurityHeaders(response) {
  assert.match(response.headers["content-security-policy"] ?? "", /object-src 'none'/u);
  assert.match(response.headers["content-security-policy"] ?? "", /frame-ancestors 'none'/u);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["x-frame-options"], "DENY");
  assert.equal(response.headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.match(response.headers["permissions-policy"] ?? "", /camera=\(\)/u);
  assert.equal(response.headers["cross-origin-opener-policy"], "same-origin");
}

function appRunArguments(configured) {
  const environment = [
    "FACTGRID_EDITING_ENABLED=false",
    "FACTGRID_SESSION_DB_PATH=/data/factgrid-sessions.sqlite",
    "NODE_EXTRA_CA_CERTS=/synthetic-certs/provider-ca.pem",
  ];
  if (configured) {
    environment.push(
      "APP_ORIGIN=https://app.factgrid.test",
      "FACTGRID_OAUTH_CALLBACK_URL=https://app.factgrid.test/api/auth/callback",
      "FACTGRID_OAUTH_CLIENT_ID=synthetic-client",
      "FACTGRID_OAUTH_CLIENT_SECRET=synthetic-client-secret",
      `SESSION_SECRET=${sessionSecret}`,
    );
  }
  return [
    "run",
    "--detach",
    "--name",
    names.app,
    "--network",
    names.network,
    "--network-alias",
    "app.factgrid.test",
    "--publish",
    "127.0.0.1::3000",
    "--mount",
    `type=volume,source=${names.dataVolume},target=/data`,
    "--mount",
    `type=volume,source=${names.certVolume},target=/synthetic-certs,readonly`,
    "--health-interval",
    "2s",
    "--health-timeout",
    "2s",
    "--health-start-period",
    "1s",
    "--health-retries",
    "30",
    ...environment.flatMap((value) => ["--env", value]),
    names.appImage,
  ];
}

async function startApp(configured) {
  docker(appRunArguments(configured), { capture: true });
  await waitForHealthy(names.app);
  assert.equal(docker(["inspect", "--format", "{{.Config.User}}", names.app], { capture: true }), "factgrid");
  assert.match(docker(["exec", names.app, "id"], { capture: true }), /^uid=1001\(factgrid\)/u);
  docker([
    "exec",
    names.app,
    "node",
    "-e",
    `const f=require('node:fs');
const protectedPaths=['/app/.next','/app/.next/server/pages-manifest.json','/app/node_modules','/app/node_modules/next/package.json','/app/package.json','/app/public','/app/public/file.svg'];
for(const path of protectedPaths){const stat=f.statSync(path);if(stat.uid!==0||(stat.mode&0o022)!==0)throw new Error(path+' is not root-owned and read-only');try{f.accessSync(path,f.constants.W_OK);throw new Error(path+' is writable by the web uid')}catch(error){if(error?.code!=='EACCES')throw error}}
const cache=f.statSync('/app/.next/cache');if(cache.uid!==1001||(cache.mode&0o777)!==0o700)throw new Error('cache ownership or mode is invalid');f.writeFileSync('/app/.next/cache/.write-check','ok',{mode:0o600});f.unlinkSync('/app/.next/cache/.write-check');`,
  ], { capture: true });
  return publishedPort(names.app, 3000);
}

function stopApp() {
  docker(["rm", "--force", names.app], { capture: true, allowFailure: true });
}

async function verifyUnavailableUi(appPort) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const routes = ["/", "/browse?q=Prag+I+437", "/tablets/Q9000002", "/about"];
    for (const route of routes) {
      const page = await browser.newPage({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 800 },
      });
      const response = await page.goto(`https://127.0.0.1:${appPort}${route}`, {
        waitUntil: "domcontentloaded",
      });
      assert.equal(response?.status(), 200, `Expected ${route} to return 200.`);
      const navigation = page.getByRole("navigation", { name: "Primary", exact: true });
      const login = navigation.getByRole("link", { name: "Log in with FactGrid", exact: true });
      await login.waitFor({ state: "visible" });
      await navigation.getByText("Unavailable", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await login.getAttribute("href"), "/about#sign-in-availability");
      await page.close();
    }

    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
    });
    await page.goto(`https://127.0.0.1:${appPort}/`, { waitUntil: "domcontentloaded" });
    const navigation = page.getByRole("navigation", { name: "Primary", exact: true });
    const login = navigation.getByRole("link", { name: "Log in with FactGrid", exact: true });
    await login.focus();
    assert.equal(await login.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/about#sign-in-availability$/u);
    await page.getByRole("heading", { name: "FactGrid sign-in", exact: true }).waitFor();
    await page.getByText("Public browsing remains available.", { exact: false }).waitFor();
    await page.close();
  } finally {
    await browser.close();
  }
}

function assertNoSyntheticSecrets(response) {
  const serialized = `${JSON.stringify(response.headers)}\n${response.body}`;
  assert.doesNotMatch(serialized, /synthetic-client-secret/u);
  assert.doesNotMatch(serialized, /docker-smoke-session-secret/u);
  assert.doesNotMatch(serialized, /synthetic-access-token/u);
  assert.doesNotMatch(serialized, /synthetic-refresh-token/u);
}

async function run() {
  log("checking Docker daemon availability");
  docker(["info"], { capture: true, timeout: 30_000 });

  log("building production and isolated provider images");
  docker(["build", "--tag", names.appImage, "."]);
  docker([
    "build",
    "--file",
    "tests/docker/Dockerfile.provider",
    "--tag",
    names.providerImage,
    ".",
  ]);

  docker(["network", "create", names.network], { capture: true });
  docker(["volume", "create", names.dataVolume], { capture: true });
  docker(["volume", "create", names.certVolume], { capture: true });

  log("starting the isolated HTTPS FactGrid fixture");
  docker([
    "run",
    "--detach",
    "--name",
    names.provider,
    "--network",
    names.network,
    "--network-alias",
    "database.factgrid.de",
    "--publish",
    "127.0.0.1::443",
    "--publish",
    "127.0.0.1::8443",
    "--mount",
    `type=volume,source=${names.certVolume},target=/shared`,
    names.providerImage,
  ], { capture: true });
  await waitForHealthy(names.provider);
  const providerPort = publishedPort(names.provider, 443);
  const appProxyPort = publishedPort(names.provider, 8443);
  const caPath = join(temporaryDirectory, "provider-ca.pem");
  mkdirSync(temporaryDirectory, { recursive: true });
  docker(["cp", `${names.provider}:/fixture/server.crt`, caPath], { capture: true });
  const providerCa = readFileSync(caPath);

  log("verifying reading-only production behavior and login discoverability");
  await startApp(false);
  let appPort = appProxyPort;
  const appTls = { ca: providerCa, servername: "app.factgrid.test" };
  const unavailable = await request({
    port: appPort,
    path: "/api/session",
    headers: forwardedHeaders,
    tls: appTls,
  });
  assert.equal(unavailable.status, 503);
  assert.equal(JSON.parse(unavailable.body).error.code, "auth_unavailable");
  assertPrivate(unavailable);
  assertSecurityHeaders(unavailable);
  assertNoSyntheticSecrets(unavailable);

  for (const path of ["/", "/browse?q=Prag+I+437", "/tablets/Q9000002", "/about"]) {
    const response = await request({ port: appPort, path, headers: forwardedHeaders, tls: appTls });
    assert.equal(response.status, 200, `Expected ${path} to return 200.`);
    assertSecurityHeaders(response);
  }
  await verifyUnavailableUi(appPort);
  stopApp();

  log("completing the synthetic OAuth flow inside the production container");
  await startApp(true);
  appPort = appProxyPort;
  const login = await request({
    port: appPort,
    path: "/api/auth/login?returnTo=%2Fabout%3Ffrom%3Ddocker%23sign-in-availability",
    headers: forwardedHeaders,
    tls: appTls,
  });
  assert.equal(login.status, 302);
  assertPrivate(login);
  assertNoSyntheticSecrets(login);
  const transaction = cookie(login.headers["set-cookie"], "factgrid_oauth_transaction");
  assert.match(transaction.header, /HttpOnly/u);
  assert.match(transaction.header, /Secure/u);
  assert.match(transaction.header, /SameSite=Lax/iu);
  assert.match(transaction.header, /Priority=High/iu);
  const authorizationUrl = new URL(login.headers.location);
  assert.equal(authorizationUrl.origin, "https://database.factgrid.de");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizationUrl.searchParams.has("code_verifier"), false);
  assert.equal(authorizationUrl.searchParams.has("client_secret"), false);

  const authorize = await request({
    port: providerPort,
    path: `${authorizationUrl.pathname}${authorizationUrl.search}`,
    headers: { host: "database.factgrid.de" },
    tls: { ca: providerCa, servername: "database.factgrid.de" },
  });
  assert.equal(authorize.status, 302);
  const callbackUrl = new URL(authorize.headers.location);
  assert.equal(callbackUrl.origin, "https://app.factgrid.test");

  const callback = await request({
    port: appPort,
    path: `${callbackUrl.pathname}${callbackUrl.search}`,
    headers: { ...forwardedHeaders, cookie: transaction.pair },
    tls: appTls,
  });
  assert.equal(callback.status, 303);
  assert.equal(callback.headers.location, "https://app.factgrid.test/about?from=docker#sign-in-availability");
  assertPrivate(callback);
  assertNoSyntheticSecrets(callback);
  const session = cookie(callback.headers["set-cookie"], "factgrid_session");
  assert.match(session.header, /HttpOnly/u);
  assert.match(session.header, /Secure/u);
  assert.match(session.header, /SameSite=Lax/iu);
  assert.match(session.header, /Priority=High/iu);

  let sessionResponse = await request({
    port: appPort,
    path: "/api/session",
    headers: { ...forwardedHeaders, cookie: session.pair },
    tls: appTls,
  });
  assert.equal(sessionResponse.status, 200);
  assertPrivate(sessionResponse);
  assertSecurityHeaders(sessionResponse);
  assertNoSyntheticSecrets(sessionResponse);
  const sessionBody = JSON.parse(sessionResponse.body);
  assert.equal(sessionBody.authenticated, true);
  assert.equal(sessionBody.user.username, "Docker Fixture Editor");
  assert.equal(sessionBody.editingEnabled, false);

  log("checking private volume ownership, SQLite sidecars, and write access");
  const fileModes = docker(
    ["exec", names.app, "sh", "-c", "stat -c '%n|%u|%g|%a' /data /data/factgrid-sessions.sqlite /data/factgrid-sessions.sqlite-wal /data/factgrid-sessions.sqlite-shm"],
    { capture: true },
  ).split(/\r?\n/u);
  const expectedPaths = new Map([
    ["/data", "700"],
    ["/data/factgrid-sessions.sqlite", "600"],
    ["/data/factgrid-sessions.sqlite-wal", "600"],
    ["/data/factgrid-sessions.sqlite-shm", "600"],
  ]);
  for (const line of fileModes) {
    const [path, uid, gid, mode] = line.split("|");
    assert.equal(uid, "1001", `${path} must belong to the application uid.`);
    assert.equal(gid, "1001", `${path} must belong to the application gid.`);
    assert.equal(mode, expectedPaths.get(path), `${path} has an unexpected mode.`);
    expectedPaths.delete(path);
  }
  assert.equal(expectedPaths.size, 0, "Expected the database and both WAL sidecars.");
  docker([
    "exec",
    names.app,
    "node",
    "-e",
    "const f=require('node:fs');f.writeFileSync('/data/.write-check','ok',{mode:0o600});f.unlinkSync('/data/.write-check')",
  ], { capture: true });

  const wrongOrigin = await request({
    port: appPort,
    path: "/api/auth/logout",
    method: "POST",
    headers: {
      ...forwardedHeaders,
      cookie: session.pair,
      origin: "https://attacker.invalid",
      "x-csrf-token": sessionBody.csrfToken,
    },
    tls: appTls,
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(JSON.parse(wrongOrigin.body).error.code, "invalid_origin");
  assertPrivate(wrongOrigin);
  assertNoSyntheticSecrets(wrongOrigin);

  log("replacing the container and confirming session persistence");
  stopApp();
  await startApp(true);
  appPort = appProxyPort;
  sessionResponse = await request({
    port: appPort,
    path: "/api/session",
    headers: { ...forwardedHeaders, cookie: session.pair },
    tls: appTls,
  });
  assert.equal(JSON.parse(sessionResponse.body).authenticated, true);

  const logout = await request({
    port: appPort,
    path: "/api/auth/logout",
    method: "POST",
    headers: {
      ...forwardedHeaders,
      cookie: session.pair,
      origin: "https://app.factgrid.test",
      "x-csrf-token": JSON.parse(sessionResponse.body).csrfToken,
    },
    tls: appTls,
  });
  assert.equal(logout.status, 204);
  assertPrivate(logout);
  const cleared = cookie(logout.headers["set-cookie"], "factgrid_session");
  assert.match(cleared.header, /Max-Age=0/u);

  log("replacing the container again and confirming revocation persistence");
  stopApp();
  await startApp(true);
  appPort = appProxyPort;
  const revoked = await request({
    port: appPort,
    path: "/api/session",
    headers: { ...forwardedHeaders, cookie: session.pair },
    tls: appTls,
  });
  assert.equal(revoked.status, 200);
  assert.equal(JSON.parse(revoked.body).authenticated, false);
  assertPrivate(revoked);
  assertNoSyntheticSecrets(revoked);

  stopApp();
  docker([
    "run",
    "--rm",
    "--name",
    names.checker,
    "--mount",
    `type=volume,source=${names.dataVolume},target=/data,readonly`,
    names.appImage,
    "node",
    "-e",
    "const f=require('node:fs');if(!f.existsSync('/data/factgrid-sessions.sqlite'))process.exit(1)",
  ], { capture: true });

  log("all Docker build, runtime, browser, persistence, and security checks passed");
}

let cleanupStarted = false;

function cleanup(bestEffort = false) {
  if (cleanupStarted) return;
  cleanupStarted = true;
  log("removing only this run's uniquely named Docker resources");
  for (const container of [names.app, names.provider, names.checker]) {
    docker(["rm", "--force", container], {
      capture: true,
      allowFailure: true,
      timeout: 5_000,
    });
  }
  for (const volume of [names.dataVolume, names.certVolume]) {
    docker(["volume", "rm", "--force", volume], {
      capture: true,
      allowFailure: true,
      timeout: 5_000,
    });
  }
  docker(["network", "rm", names.network], {
    capture: true,
    allowFailure: true,
    timeout: 5_000,
  });
  for (const image of [names.appImage, names.providerImage]) {
    docker(["image", "rm", "--force", image], {
      capture: true,
      allowFailure: true,
      timeout: 5_000,
    });
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });

  if (!bestEffort) {
    const remaining = [];
    for (const container of [names.app, names.provider, names.checker]) {
      const found = docker(
        ["container", "ls", "--all", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"],
        { capture: true },
      );
      if (found) remaining.push(`container:${found}`);
    }
    for (const volume of [names.dataVolume, names.certVolume]) {
      const found = docker(
        ["volume", "ls", "--filter", `name=^${volume}$`, "--format", "{{.Name}}"],
        { capture: true },
      );
      if (found) remaining.push(`volume:${found}`);
    }
    const network = docker(
      ["network", "ls", "--filter", `name=^${names.network}$`, "--format", "{{.Name}}"],
      { capture: true },
    );
    if (network) remaining.push(`network:${network}`);
    for (const image of [names.appImage, names.providerImage]) {
      const found = docker(
        ["image", "ls", "--filter", `reference=${image}:latest`, "--format", "{{.Repository}}:{{.Tag}}"],
        { capture: true },
      );
      if (found) remaining.push(`image:${found}`);
    }
    if (remaining.length > 0) {
      throw new Error(`Docker cleanup left task resources: ${remaining.join(", ")}`);
    }
    log("cleanup audit confirmed no task resources remain");
  }
}

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    cleanup(true);
    process.exit(exitCode);
  });
}

try {
  await run();
} finally {
  cleanup();
}
