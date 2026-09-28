export const FACTGRID_ORIGIN = "https://database.factgrid.de";
export const FACTGRID_OAUTH_ISSUER = FACTGRID_ORIGIN;
export const FACTGRID_OAUTH_AUTHORIZE_URL =
  `${FACTGRID_ORIGIN}/w/rest.php/oauth2/authorize`;
export const FACTGRID_OAUTH_TOKEN_URL =
  `${FACTGRID_ORIGIN}/w/rest.php/oauth2/access_token`;
export const FACTGRID_OAUTH_PROFILE_URL =
  `${FACTGRID_ORIGIN}/w/rest.php/oauth2/resource/profile`;
// Use index.php with an explicit title so the signed query is exactly what
// MediaWiki receives, including on installations with rewritten pretty URLs.
export const FACTGRID_OAUTH1_INITIATE_URL =
  `${FACTGRID_ORIGIN}/w/index.php?title=Special:OAuth/initiate`;
export const FACTGRID_OAUTH1_AUTHORIZE_URL =
  `${FACTGRID_ORIGIN}/wiki/Special:OAuth/authorize`;
export const FACTGRID_OAUTH1_TOKEN_URL =
  `${FACTGRID_ORIGIN}/w/index.php?title=Special:OAuth/token`;
export const FACTGRID_OAUTH1_IDENTIFY_URL =
  `${FACTGRID_ORIGIN}/w/index.php?title=Special:OAuth/identify`;

export const AUTH_CALLBACK_PATH = "/api/auth/callback";
export const SESSION_COOKIE_NAME = "factgrid_session";
export const OAUTH_TRANSACTION_COOKIE_NAME = "factgrid_oauth_transaction";
export const CSRF_HEADER_NAME = "x-csrf-token";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const OAUTH_TRANSACTION_TTL_SECONDS = 10 * 60;
export const UPSTREAM_TIMEOUT_MS = 10_000;
