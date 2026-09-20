# Operations

## Deployment profile

Build and run the application on Node.js 22+:

```bash
npm ci
npm run check
npm start
```

The current session store requires one Node process (or one application instance)
and a persistent writable volume for `.data/factgrid-sessions.sqlite`. Do not deploy
editing to an ephemeral or horizontally replicated runtime without first replacing
the session store with a shared implementation that preserves the same encryption,
expiry, and deletion properties.

Use a private persistent directory owned by the application account. The process
forces the SQLite database to mode `0600`; the volume and its WAL sidecars must
also be inaccessible to other accounts. Configure HSTS at the TLS terminator.

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

## Reading-only deployment

No secrets are required. Leave the OAuth fields empty and
`FACTGRID_EDITING_ENABLED=false`. `/api/session` returns an unavailable status and
the interface visibly remains in reading mode. Public FactGrid reads continue.

## Enabling FactGrid sign-in

A FactGrid administrator must register and approve a confidential OAuth 2 client:

1. use authorization-code and refresh-token grants;
2. request the minimum `editpage` grant plus provider-required basic access;
3. register the exact HTTPS callback
   `https://YOUR_ORIGIN/api/auth/callback` (no wildcard);
4. provide the client ID and secret through the deployment secret manager;
5. set a random `SESSION_SECRET` of at least 32 bytes;
6. set `APP_ORIGIN`, `FACTGRID_OAUTH_CALLBACK_URL`, and a persistent
   `FACTGRID_SESSION_DB_PATH`.

Restart, confirm `/api/session` is private/no-store, and complete sign-in with a
non-writing account before considering edits.

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

## Verification

For each release:

```bash
npm ci
npm audit --omit=dev
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Then smoke-test `/`, `/about`, `/browse`, one sparse tablet, and one multi-edition
tablet at desktop and mobile widths. Treat a FactGrid timeout as an upstream error,
not an empty catalogue.

## Troubleshooting

- **Reading mode appears:** one or more required OAuth settings is absent/invalid,
  or session storage could not open. Check names and file permissions, never log secrets.
- **Sign-in callback rejected:** the request origin/path or state transaction did
  not match. Confirm the exact callback at both FactGrid and the deployment.
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
