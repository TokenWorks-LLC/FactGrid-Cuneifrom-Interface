# Operations

## Deployment profile

Build and run the application on Node.js 22+:

```bash
npm ci
npm run check
npm start
```

The repository also includes a production `Dockerfile`. Build and run one
instance with a persistent session volume:

```bash
docker build -t factgrid-cuneiform-interface .
docker volume create factgrid-cuneiform-sessions
docker run --rm -p 127.0.0.1:3000:3000 --env-file .env.production \
  -e FACTGRID_SESSION_DB_PATH=/data/factgrid-sessions.sqlite \
  -v factgrid-cuneiform-sessions:/data \
  factgrid-cuneiform-interface
```

The image runs as the non-root `factgrid` account with UID/GID 1001. An empty
named volume mounted at `/data` inherits the image directory's UID/GID 1001 and
mode `0700`; the container starts with `umask 077`, and the session database,
WAL, and SHM files are mode `0600`. For a bind mount, create the host directory
in advance, make it writable by UID/GID 1001, and restrict it to mode `0700`.
Do not work around a permission error with a world-writable directory.

The built-in health check requests the local home page and therefore reports
whether the Next.js process can serve HTTP; it does not claim that FactGrid or
OAuth is currently reachable. Treat sanitized 502/503 application responses as
dependency or configuration failures and inspect container logs without printing
environment values, cookies, authorization codes, or tokens.

The current session store requires one Node process (or one application instance)
and a persistent writable database at the configured path (`/data/factgrid-sessions.sqlite`
in the Docker example, `.data/factgrid-sessions.sqlite` by default for a local Node
process). Do not deploy editing to an ephemeral or horizontally replicated runtime
without first replacing the session store with a shared implementation that
preserves the same encryption, expiry, and deletion properties.

Keep the same mounted volume, `SESSION_SECRET`, and OAuth client configuration
when replacing the container. A local application session then survives a normal
replacement. Logout deletes its database row, so revocation also survives later
replacements. To rotate `SESSION_SECRET`, stop the service and delete the old
session database before restarting; this intentionally signs everyone out. Never
attempt to reuse provider tokens encrypted with the previous key.

Use a private persistent directory owned by the application account. On POSIX the
process forces the SQLite database to mode `0600`; the volume and its WAL sidecars
must also be inaccessible to other accounts. Configure HSTS at the TLS terminator.

Public reading needs outbound HTTPS access to `database.factgrid.de`; the homepage
also loads its attributed image from Wikimedia Commons. Keep the reverse proxy’s
request-body limit at or below the application limit and forward the original
scheme/host consistently with `APP_ORIGIN`. Apply ordinary edge request-rate
limits to public reads and tighter limits to OAuth start/callback routes. The
in-process write limiter is keyed by FactGrid identity and assumes the documented
single-instance deployment.

The application emits a restrictive CSP plus framing, content-type, referrer,
permissions, and opener policies. Validate those headers after any proxy or CDN
change; the proxy must not replace them with weaker values.

Terminate public TLS at a reverse proxy and keep port 3000 private to that proxy.
Set `APP_ORIGIN` to the exact external HTTPS origin and register
`${APP_ORIGIN}/api/auth/callback` verbatim. The proxy must replace, rather than
append untrusted client values to, `Host`, `X-Forwarded-Host`, and
`X-Forwarded-Proto`; forward the external host and `https`. Production cookies
are `Secure`, `HttpOnly`, `SameSite=Lax`, path-wide, and high priority, so a
configured sign-in cannot be tested through direct plain HTTP. Never publish the
backend port as an alternate sign-in origin.

## Reading-only deployment

No secrets are required. Leave the OAuth fields empty and
`FACTGRID_EDITING_ENABLED=false`. `/api/session` returns an unavailable status and
the shared desktop/mobile header keeps `Log in with FactGrid` visible with an
`Unavailable` status. That entry opens an accessible explanation rather than a
raw API error. Public FactGrid reads continue.

## Enabling FactGrid sign-in

A FactGrid `sysop` must register and approve a confidential, non-owner-only OAuth
2 client. Other FactGrid accounts can authorize it after approval; they do not
need separate administrator approval:

1. use authorization-code and refresh-token grants;
2. request the minimum `editpage` grant plus provider-required basic access;
3. register the exact HTTPS callback
   `https://YOUR_ORIGIN/api/auth/callback` (no wildcard);
4. provide the client ID and secret through the deployment secret manager;
5. set a random `SESSION_SECRET` of at least 32 bytes;
6. set `APP_ORIGIN`, `FACTGRID_OAUTH_CALLBACK_URL`, and a persistent
   `FACTGRID_SESSION_DB_PATH`.

Restart, confirm `/api/session` is private/no-store, and complete sign-in with a
non-writing account before considering edits. A configured anonymous browser is
sent through the real FactGrid authorization flow and returned only to its
validated same-origin path. After authentication the header shows the FactGrid
username and logout. These controls remain available when editing is disabled or
the account is absent from the editor allowlist.

## Enabling writes

Do not enable writes merely because sign-in works. Obtain the cuneiform project’s
editor policy and a designated test record first.

1. Put exact approved FactGrid usernames in `FACTGRID_ALLOWED_EDITORS`.
2. Put exact `QID|Document title` pairs in `FACTGRID_ALLOWED_EDIT_TARGETS`.
3. Set the designated test QID/title in the write-test variables for operator clarity.
4. Set `FACTGRID_EDITING_ENABLED=true` only in the test deployment.
5. Sign in as an approved user, make a harmless authorized change on that designated
   page, and verify the new revision and attribution in FactGrid history.
6. Test stale-revision conflict, blocked/unapproved account denial, logout, and a
   direct request with a changed QID/edition ID.
7. Expand target and editor allowlists only after project approval.

The service checks live identity, rights, blocks, page protections, target linkage,
source format, and base revision for each request. An empty allowlist denies writes.

Application logout removes the local application session. It does not revoke the
provider grant; users can revoke that separately from FactGrid's connected-
applications management page. If local session storage fails during logout, the
browser cookie is still cleared and the UI reports that server-side revocation
could not be confirmed. The user should then revoke the connected application in
FactGrid so any orphaned provider token can no longer be used.

## Verification

For each release:

```bash
npm ci
npm audit --omit=dev
npm run lint
npm run typecheck
npm test
npx playwright install --with-deps chromium # clean Linux host/CI
npx playwright install chromium             # macOS/Windows
npm run test:docker
npm run test:e2e
npm run test:e2e:live
npm run build
```

The Docker smoke command creates only uniquely named `factgrid-task-*` images,
containers, networks, and disposable volumes, then removes those exact resources.
It builds the actual production image and uses a separate, local HTTPS FactGrid
fixture plus TLS reverse proxy to exercise the real login, callback, session, and
logout handlers with synthetic credentials. Passing it establishes container and
fixture-based authentication behavior only; it does not establish that a real
FactGrid OAuth consumer has been approved or that live FactGrid sign-in works.

The required `test:e2e` check runs the full Next.js application at desktop and
mobile widths against checked-in adapter fixtures. This keeps homepage, search,
filtering, multi-edition navigation, transcript rendering, and unavailable-auth
acceptance deterministic. Its one reported skip is only the duplicate desktop
execution of an assertion that explicitly requires the mobile navigation layout;
the mobile project runs that assertion.

`test:e2e:live` separately smoke-tests the public search and plain-transcript
contract against current FactGrid records in one desktop worker. CI reports that
result as advisory because a public upstream timeout must not turn a validated
application build red. A release operator should still run it from the deployment
network and record failures as upstream errors, never as an empty catalogue.

Then smoke-test `/`, `/about`, `/browse`, one sparse tablet, and one multi-edition
tablet at desktop and mobile widths on the deployed origin.

For configured authentication, sign in, restart the same process/container with
the same mounted volume, and confirm the session survives. Confirm the database,
WAL, and SHM files are accessible only to the application account. At the reverse
proxy, verify the external origin exactly matches `APP_ORIGIN`, callbacks remain
HTTPS, private API responses keep `Cache-Control: private, no-store`, and security
headers are not weakened. A confirmed changed live write must read back the exact
revision, full source, FactGrid username/user ID, and edit summary before the UI
reports success.

## Troubleshooting

- **Reading mode appears:** one or more required OAuth settings is absent/invalid,
  or session storage could not open. Check names and file permissions, never log secrets.
- **Sign-in callback rejected:** the request origin/path or state transaction did
  not match. Confirm the exact callback at both FactGrid and the deployment.
- **OAuth configuration was removed with active sessions:** logout still expires
  the browser cookie, but cannot confirm deletion of the encrypted server row
  while the session-store configuration is unavailable. Restore the same secure
  configuration to revoke it, or rotate `SESSION_SECRET` and remove the session
  database to invalidate every outstanding session; revoke the FactGrid consumer
  as well if its credentials may be compromised.
- **Signed in but no editor:** the feature switch, username allowlist, or target
  allowlist is closed; this is the expected safe default.
- **409 conflict:** preserve the draft, inspect FactGrid history, reload, and reapply
  intentionally. Do not replay the prior request.
- **Unknown save outcome:** check FactGrid history before trying again. The service
  intentionally does not retry a potentially accepted write.
- **Upstream timeout:** retry after a pause. Do not increase query breadth; the app’s
  bounded contract is intentional.

## Rollback

Set `FACTGRID_EDITING_ENABLED=false` first to stop new writes without affecting
reading. Roll back the application artifact to the prior tested commit, keeping the
session volume intact if sign-in should survive. If OAuth credentials may have been
exposed, revoke/rotate them in FactGrid, rotate `SESSION_SECRET`, delete the session
database, and require all users to sign in again.
