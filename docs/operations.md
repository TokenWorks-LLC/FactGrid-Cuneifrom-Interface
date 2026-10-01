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
The checked-in `deploy/nginx/factgrid.conf.template` and
`deploy/nginx/factgrid-proxy-headers.conf` provide the deployable boundary used by
the test fixtures. Install them in nginx's `http` context, supply the documented
TLS/upstream environment values, validate with `nginx -t`, and expose only nginx.
Set `APP_ORIGIN` to the exact external HTTPS origin and register
`${APP_ORIGIN}/api/auth/callback` verbatim. The proxy must replace, rather than
append untrusted client values to, `Host`, `X-Forwarded-Host`, and
`X-Forwarded-Proto`; it must also overwrite `X-Forwarded-For` and
`X-FactGrid-Client-IP`. Set `FACTGRID_TRUST_PROXY=true` only when direct access to
the application port is impossible. With proxy trust disabled, arbitrary internet
headers are ignored and the in-process fallback intentionally shares one bounded
bucket. Production cookies
are `Secure`, `HttpOnly`, `SameSite=Lax`, path-wide, and high priority, so a
configured sign-in cannot be tested through direct plain HTTP. Never publish the
backend port as an alternate sign-in origin.

## Reading-only deployment

No secrets are required. Leave the OAuth fields empty and
`FACTGRID_EDITING_ENABLED=false`. `/api/session` returns an unavailable status and
the shared desktop/mobile header keeps `Log in with FactGrid` visible with an
`Unavailable` status. That entry opens an accessible explanation rather than a
raw API error. Public FactGrid reads continue. `/tablets/[qid]/edit` shows an
unavailable message without editing controls until sign-in and editing are configured.

## Enabling FactGrid sign-in

FactGrid's developer has confirmed that the operator can propose an OAuth 1.0a
consumer and FactGrid administrators can approve it. Use the
[OAuth 1.0a registration form](https://database.factgrid.de/wiki/Special:OAuthConsumerRegistration/propose/oauth1a):

1. register an application usable by other accounts, leaving owner-only mode off;
2. request **Edit existing pages** and required basic access. Also request
   **Create, edit, and move pages** when missing-transcription creation is enabled.
   The application verifies the reported grant and effective live rights; a grant
   alone never authorizes a write;
3. register the exact HTTPS callback
   `https://YOUR_ORIGIN/api/auth/callback`, with callback-prefix matching disabled.
   The application sends `oauth_callback=oob` to use that exact registered URL;
4. set `FACTGRID_OAUTH_VERSION=1.0a` and provide `FACTGRID_OAUTH_CONSUMER_KEY` and
   `FACTGRID_OAUTH_CONSUMER_SECRET` through the deployment secret manager;
5. set a random `SESSION_SECRET` of at least 32 bytes;
6. set `APP_ORIGIN`, `FACTGRID_OAUTH_CALLBACK_URL`, and a persistent
   `FACTGRID_SESSION_DB_PATH`.

Share the consumer registration identifier and repository URL with the approving
administrator. Do not email secrets or commit them. Each user's access token and
token secret are obtained during authorization and encrypted in the session store;
they are not shared deployment configuration. There is no OAuth 1.0a refresh token.
Local logout removes the application session; revoking the provider grant is a
separate FactGrid action.

Sessions are bound to the configured protocol, issuer, and exact consumer/client
identifier. Changing any of them requires fresh login. Existing database rows
created before this binding was stored fail closed; do not backfill a guessed
registration. The migration itself is automatic and leaves legacy binding columns
null for that reason.

Existing OAuth 2 deployments can retain `FACTGRID_OAUTH_VERSION=2.0` with
`FACTGRID_OAUTH_CLIENT_ID` and `FACTGRID_OAUTH_CLIENT_SECRET`. An omitted version
also preserves that legacy behavior. Do not place OAuth 1.0a credentials into the
OAuth 2 fields. Changing protocols requires a fresh login.

Restart, confirm `/api/session` is private/no-store, and complete sign-in with a
non-writing account before considering edits. A configured anonymous browser is
sent through the real FactGrid authorization flow and returned only to its
validated same-origin path. After authentication the header shows the FactGrid
username and logout. These controls remain available when editing is disabled or
the account is absent from the editor allowlist.

## Enabling writes

Do not enable writes merely because sign-in works. Obtain the cuneiform project’s
editor policy and a designated test record first.

1. Choose `FACTGRID_CONTRIBUTOR_POLICY=restricted` (the safe default) unless the
   project has explicitly approved every authenticated FactGrid account with live
   edit rights to contribute through this deployment.
2. For `restricted`, put exact approved usernames in `FACTGRID_ALLOWED_EDITORS`.
   An empty username list denies every write. Transcription updates and creation
   additionally require exact `QID|Document title` pairs in
   `FACTGRID_ALLOWED_EDIT_TARGETS`; an empty target list denies those operations.
   Metadata writes do not consult the target list: an approved editor can edit any
   current catalogue tablet, subject to FactGrid permissions and validation.
   For `authenticated`, both deployment lists are intentionally ignored; current
   membership/linkage and every provider-side check still apply.
3. Set the designated test QID/title in the write-test variables for operator clarity.
   These variables are not enforced by the application. A single transcription
   target does not restrict metadata writes to that QID; agree the metadata test
   scope with the approved tester before enabling writes.
4. Set `FACTGRID_EDITING_ENABLED=true` only in the test deployment.
5. Sign in as an approved user, make a harmless authorized change on that designated
   page, and verify the new revision and attribution in FactGrid history.
6. Test stale-revision conflict, blocked/unapproved account denial, logout, and a
   direct request with a changed QID/edition ID.
7. Expand allowlists, or promote from `restricted` to `authenticated`, only after
   project approval. Treat a policy change as a security-sensitive deployment change.

The service checks live identity, rights, blocks, reported grants, current catalogue
membership/linkage, page action eligibility where applicable, datatypes, and base
revision for each request. Metadata updates need the edit grant/right. Creating a
new `D-Q{qid}` page also needs the create grant/right. Neither route accepts a
browser-selected host, arbitrary document title, or raw metadata patch.

Exact duplicate metadata additions are rejected before provider inspection,
including a new statement identical to a current statement. Existing historical
duplicates are preserved. P251 cannot be authored or removed through the generic
metadata route, including qualifiers and references; use the dedicated transcript
workflow. A definite revision followed by failed readback or attribution is shown
as accepted but unconfirmed and must be reconciled in FactGrid history before a
new workflow is started.

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
The default harness protocol is OAuth 1.0a. Set
`FACTGRID_DOCKER_OAUTH_VERSION=2.0` for the legacy OAuth 2 flow; CI verifies both.

The required `test:e2e` check runs the full Next.js application at desktop and
mobile widths against checked-in adapter fixtures. This keeps homepage, search,
filtering, multi-edition navigation, transcript rendering, authenticated editor access, and unavailable-auth
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
- **Signed in but no editor:** check the feature switch and contributor policy;
  in `restricted` mode, the username must be on the editor allowlist. The document-
  target allowlist is an additional requirement for transcription saves and
  creation, not for metadata edits.
- **Metadata editor loads but a statement is disabled:** its datatype or shape is
  not safely supported. Edit it in FactGrid; do not coerce it into another type.
- **Transcription creation is partial:** inspect the canonical `D-Q{qid}` page and
  the item P251 statements. Retry through the UI only after inspection; recovery
  will derive state from FactGrid and link a confirmed canonical page if safe.
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
