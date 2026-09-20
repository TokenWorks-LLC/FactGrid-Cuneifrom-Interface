import "server-only";

import { adaptDocumentRevision } from "@/lib/factgrid/adapters";
import { FACTGRID, FACTGRID_LIMITS } from "@/lib/factgrid/constants";
import { createFactGridClient } from "@/lib/factgrid/server";
import { spliceTranscriptSource } from "@/lib/factgrid/transcript";
import type {
  MediaWikiPage,
  TabletEdition,
  TranscriptRegion,
} from "@/lib/factgrid/types";

import { TranscriptEditError, isTranscriptEditError } from "./errors";
import type { TranscriptWriteRequest } from "./request";
import type { VerifiedEditorIdentity } from "./authorization";
import { isAllowedEditTarget, parseAllowedEditTargets } from "./targets";

type ServerFetch = typeof globalThis.fetch;

interface MediaWikiUserInfo {
  id?: number;
  name?: string;
  anon?: boolean;
  blockid?: number;
  blockedby?: string;
  blockreason?: string;
  blockexpiry?: string;
  groups?: string[];
  rights?: string[];
}

interface ProtectedMediaWikiPage extends MediaWikiPage {
  lastrevid?: number;
  contentmodel?: string;
  protection?: Array<{ type?: string; level?: string; expiry?: string }>;
  actions?: { edit?: boolean };
}

interface InspectResponse {
  error?: { code?: string; info?: string };
  curtimestamp?: string;
  query?: {
    userinfo?: MediaWikiUserInfo;
    tokens?: { csrftoken?: string };
    pages?: ProtectedMediaWikiPage[];
  };
}

interface ReadbackResponse {
  error?: { code?: string; info?: string };
  query?: { pages?: ProtectedMediaWikiPage[] };
}

interface EditResponse {
  error?: { code?: string; info?: string };
  edit?: {
    result?: string;
    pageid?: number;
    title?: string;
    oldrevid?: number;
    newrevid?: number;
    newtimestamp?: string;
    nochange?: boolean;
  };
}

export interface EditableEditionSnapshot {
  title: string;
  pageId: number;
  revisionId: number;
  timestamp: string;
  source: string;
  transcript: TranscriptRegion;
  csrfToken: string;
  requestStartedAt: string;
}

export interface SavedTranscript {
  revisionId: number;
  text: string;
}

export interface MediaWikiEditClient {
  inspectEdition(
    accessToken: string,
    edition: TabletEdition,
    identity: VerifiedEditorIdentity,
  ): Promise<EditableEditionSnapshot>;
  submitEdit(
    accessToken: string,
    snapshot: EditableEditionSnapshot,
    request: TranscriptWriteRequest,
  ): Promise<SavedTranscript>;
}

export interface MediaWikiEditClientOptions {
  fetch?: ServerFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function providerUnavailable(message: string, cause?: unknown): TranscriptEditError {
  return new TranscriptEditError("factgrid_unavailable", message, {
    status: 502,
    cause,
  });
}

async function boundedJson<T>(response: Response, maxBytes: number): Promise<T> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw providerUnavailable("FactGrid returned an unexpectedly large response.");
  }
  if (!response.body) {
    throw providerUnavailable("FactGrid returned an empty response.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw providerUnavailable("FactGrid returned an unexpectedly large response.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (isTranscriptEditError(error)) throw error;
    throw providerUnavailable("The FactGrid response could not be read.", error);
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw providerUnavailable("FactGrid returned invalid UTF-8.", cause);
  }
  try {
    return JSON.parse(body) as T;
  } catch (cause) {
    throw providerUnavailable("FactGrid returned an invalid response.", cause);
  }
}

function assertTrustedApiUrl(url: URL): void {
  if (
    url.origin !== FACTGRID.origin ||
    url.pathname !== new URL(FACTGRID.api).pathname ||
    url.username ||
    url.password
  ) {
    throw new TranscriptEditError(
      "unsupported_edition",
      "The edition does not resolve to the fixed FactGrid API.",
      { status: 409 },
    );
  }
}

function pageFromResponse(
  pages: ProtectedMediaWikiPage[] | undefined,
  expectedTitle: string,
): ProtectedMediaWikiPage {
  if (!Array.isArray(pages) || pages.length !== 1) {
    throw providerUnavailable("FactGrid did not return the expected document page.");
  }
  const page = pages[0];
  if (
    page.missing ||
    page.invalid ||
    page.ns !== 0 ||
    page.title !== expectedTitle ||
    typeof page.pageid !== "number" ||
    !Number.isSafeInteger(page.pageid)
  ) {
    throw new TranscriptEditError(
      "unsupported_edition",
      "The attached FactGrid document page is missing or no longer an exact editable target.",
      { status: 409 },
    );
  }
  return page;
}

function hasBlockInfo(userinfo: MediaWikiUserInfo): boolean {
  return (
    "blockid" in userinfo ||
    "blockedby" in userinfo ||
    "blockreason" in userinfo ||
    "blockexpiry" in userinfo
  );
}

function verifyApiIdentity(
  userinfo: MediaWikiUserInfo | undefined,
  identity: VerifiedEditorIdentity,
): void {
  if (
    !userinfo ||
    userinfo.anon === true ||
    typeof userinfo.id !== "number" ||
    String(userinfo.id) !== identity.providerUserId ||
    userinfo.name !== identity.username
  ) {
    throw new TranscriptEditError(
      "identity_mismatch",
      "The authenticated FactGrid API identity did not match this session. Sign in again.",
      { status: 401 },
    );
  }
  if (hasBlockInfo(userinfo)) {
    throw new TranscriptEditError(
      "account_blocked",
      "This FactGrid account is currently blocked from editing.",
      { status: 403 },
    );
  }
  if (!Array.isArray(userinfo.rights) || !userinfo.rights.includes("edit")) {
    throw new TranscriptEditError(
      "missing_edit_right",
      "This FactGrid account does not currently have the edit right.",
      { status: 403 },
    );
  }
}

function editError(error: EditResponse["error"]): TranscriptEditError {
  const code = error?.code ?? "unknown";
  if (
    [
      "editconflict",
      "pagedeleted",
      "articleexists",
      "edit-already-exists",
      "edit-gone-missing",
    ].includes(code)
  ) {
    return new TranscriptEditError(
      "edit_conflict",
      "FactGrid has a newer or changed version of this page. Reload before saving again.",
      { status: 409 },
    );
  }
  if (code === "badtoken" || code === "assertuserfailed" || code === "notloggedin") {
    return new TranscriptEditError(
      "identity_mismatch",
      "The FactGrid session is no longer valid. Sign in again.",
      { status: 401 },
    );
  }
  if (
    ["blocked", "autoblocked", "protectedpage", "permissiondenied", "cantcreate"]
      .some((prefix) => code === prefix || code.startsWith(`${prefix}-`))
  ) {
    return new TranscriptEditError(
      "page_not_editable",
      "FactGrid no longer permits this account to edit the selected page.",
      { status: 403 },
    );
  }
  if (code === "ratelimited" || code === "maxlag") {
    return new TranscriptEditError(
      "provider_rejected_edit",
      "FactGrid is busy and did not accept the edit. Try again later.",
      { status: 503 },
    );
  }
  return new TranscriptEditError(
    "provider_rejected_edit",
    "FactGrid rejected the edit. Your draft has not been cleared.",
    { status: 422 },
  );
}

export function createMediaWikiEditClient(
  options: MediaWikiEditClientOptions = {},
): MediaWikiEditClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? FACTGRID_LIMITS.timeoutMs;
  const maxResponseBytes = options.maxResponseBytes ?? FACTGRID_LIMITS.maxResponseBytes;

  if (typeof fetchImpl !== "function") {
    throw providerUnavailable("Server fetch is unavailable.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw providerUnavailable("The FactGrid request timeout is invalid.");
  }
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes <= 0 ||
    maxResponseBytes > 10_000_000
  ) {
    throw providerUnavailable("The FactGrid response limit is invalid.");
  }

  async function getJson<T>(
    parameters: Record<string, string>,
    accessToken: string,
  ): Promise<T> {
    const url = new URL(FACTGRID.api);
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, value);
    }
    assertTrustedApiUrl(url);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": "FactGrid-Cuneiform-Interface/0.1 (transcript editor)",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw providerUnavailable("FactGrid could not be reached.", cause);
    }
    if (!response.ok) {
      throw providerUnavailable(`FactGrid returned HTTP ${response.status}.`);
    }
    return boundedJson<T>(response, maxResponseBytes);
  }

  async function inspectEdition(
    accessToken: string,
    edition: TabletEdition,
    identity: VerifiedEditorIdentity,
  ): Promise<EditableEditionSnapshot> {
    if (!edition.reference || !edition.editionId) {
      throw new TranscriptEditError(
        "unsupported_edition",
        "The selected edition is no longer an editable FactGrid P251 document.",
        { status: 409 },
      );
    }

    const response = await getJson<InspectResponse>(
      {
        action: "query",
        format: "json",
        formatversion: "2",
        curtimestamp: "1",
        meta: "userinfo|tokens",
        uiprop: "blockinfo|groups|rights",
        type: "csrf",
        prop: "info|revisions",
        inprop: "protection",
        intestactions: "edit",
        intestactionsdetail: "boolean",
        rvlimit: "1",
        rvprop: "ids|timestamp|content|contentmodel",
        rvslots: "main",
        titles: edition.reference.title,
      },
      accessToken,
    );
    if (response.error) throw providerUnavailable("FactGrid rejected the page inspection.");

    verifyApiIdentity(response.query?.userinfo, identity);
    const page = pageFromResponse(response.query?.pages, edition.reference.title);
    if (!Array.isArray(page.protection) || page.actions?.edit !== true) {
      throw new TranscriptEditError(
        "page_not_editable",
        "FactGrid does not currently permit this account to edit the selected page.",
        { status: 403 },
      );
    }

    const loaded = adaptDocumentRevision(edition, page);
    const revision = loaded.revision;
    if (
      loaded.status !== "loaded" ||
      !revision ||
      revision.contentModel !== "wikitext" ||
      revision.contentFormat !== "text/x-wiki" ||
      !revision.transcript?.editable ||
      revision.transcript.format !== "plain-poem-v1"
    ) {
      throw new TranscriptEditError(
        "unsupported_edition",
        "Only a loaded FactGrid wikitext edition with one plain transliteration region can be edited.",
        { status: 409 },
      );
    }
    if (page.lastrevid !== undefined && page.lastrevid !== revision.revisionId) {
      throw providerUnavailable("FactGrid returned inconsistent revision metadata.");
    }

    const csrfToken = response.query?.tokens?.csrftoken;
    if (
      typeof csrfToken !== "string" ||
      csrfToken.length < 8 ||
      csrfToken.length > 512 ||
      csrfToken === "+\\"
    ) {
      throw new TranscriptEditError(
        "identity_mismatch",
        "FactGrid did not issue an authenticated edit token. Sign in again.",
        { status: 401 },
      );
    }
    if (
      typeof response.curtimestamp !== "string" ||
      !Number.isFinite(Date.parse(response.curtimestamp))
    ) {
      throw providerUnavailable("FactGrid did not return a valid request timestamp.");
    }

    return {
      title: edition.reference.title,
      pageId: page.pageid as number,
      revisionId: revision.revisionId,
      timestamp: revision.timestamp,
      source: revision.source,
      transcript: revision.transcript,
      csrfToken,
      requestStartedAt: response.curtimestamp,
    };
  }

  async function postEdit(
    accessToken: string,
    parameters: URLSearchParams,
  ): Promise<EditResponse> {
    const url = new URL(FACTGRID.api);
    assertTrustedApiUrl(url);

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "FactGrid-Cuneiform-Interface/0.1 (transcript editor)",
        },
        body: parameters,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new TranscriptEditError(
        "save_status_unknown",
        "The connection ended before FactGrid confirmed the edit. Check page history before trying again.",
        { status: 502, cause },
      );
    }
    if (!response.ok) {
      throw new TranscriptEditError(
        "save_status_unknown",
        "FactGrid did not return a conclusive edit response. Check page history before trying again.",
        { status: 502 },
      );
    }
    try {
      return await boundedJson<EditResponse>(response, maxResponseBytes);
    } catch (cause) {
      throw new TranscriptEditError(
        "save_status_unknown",
        "FactGrid returned an inconclusive edit response. Check page history before trying again.",
        { status: 502, cause },
      );
    }
  }

  async function readBack(
    accessToken: string,
    title: string,
  ): Promise<ProtectedMediaWikiPage> {
    const response = await getJson<ReadbackResponse>(
      {
        action: "query",
        format: "json",
        formatversion: "2",
        prop: "revisions",
        rvlimit: "1",
        rvprop: "ids|timestamp|content|contentmodel",
        rvslots: "main",
        titles: title,
      },
      accessToken,
    );
    if (response.error) throw providerUnavailable("FactGrid rejected the save readback.");
    return pageFromResponse(response.query?.pages, title);
  }

  async function submitEdit(
    accessToken: string,
    snapshot: EditableEditionSnapshot,
    request: TranscriptWriteRequest,
  ): Promise<SavedTranscript> {
    if (request.baseRevision !== snapshot.revisionId) {
      throw new TranscriptEditError(
        "edit_conflict",
        "FactGrid has a newer revision than the one opened in the editor. Reload before saving.",
        { status: 409 },
      );
    }

    const updatedSource = spliceTranscriptSource(
      snapshot.source,
      snapshot.transcript,
      request.text,
    );
    const summary =
      request.summary.trim() || "Update transliteration via FactGrid Cuneiform Interface";
    const parameters = new URLSearchParams({
      action: "edit",
      format: "json",
      formatversion: "2",
      assert: "user",
      title: snapshot.title,
      text: updatedSource,
      token: snapshot.csrfToken,
      summary,
      nocreate: "1",
      baserevid: String(snapshot.revisionId),
      basetimestamp: snapshot.timestamp,
      starttimestamp: snapshot.requestStartedAt,
      watchlist: "nochange",
    });

    const response = await postEdit(accessToken, parameters);
    if (response.error) throw editError(response.error);
    if (response.edit?.result !== "Success" || response.edit.title !== snapshot.title) {
      throw new TranscriptEditError(
        "save_status_unknown",
        "FactGrid returned an inconclusive edit result. Check page history before trying again.",
        { status: 502 },
      );
    }
    const expectedRevision = response.edit.nochange
      ? snapshot.revisionId
      : response.edit.newrevid;
    if (
      typeof expectedRevision !== "number" ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision <= 0
    ) {
      throw new TranscriptEditError(
        "save_status_unknown",
        "FactGrid did not identify the saved revision. Check page history before trying again.",
        { status: 502 },
      );
    }

    let page: ProtectedMediaWikiPage;
    try {
      page = await readBack(accessToken, snapshot.title);
    } catch (cause) {
      throw new TranscriptEditError(
        "save_confirmation_failed",
        "FactGrid accepted the edit, but the saved revision could not be read back. Check page history before editing again.",
        { status: 502, cause },
      );
    }
    const revision = page.revisions?.[0];
    const source = revision?.slots?.main?.content;
    if (revision?.revid !== expectedRevision || source !== updatedSource) {
      throw new TranscriptEditError(
        "save_confirmation_failed",
        "FactGrid accepted the edit, but the current page no longer matches it. Check page history before editing again.",
        { status: 409 },
      );
    }
    return { revisionId: expectedRevision, text: request.text };
  }

  return Object.freeze({ inspectEdition, submitEdit });
}

export interface SaveTranscriptInput {
  qid: string;
  editionId: string;
  accessToken: string;
  identity: VerifiedEditorIdentity;
  request: TranscriptWriteRequest;
}

export interface SaveTranscriptDependencies {
  factGrid?: {
    resolveCurrentEdition(qid: string, editionId: string): Promise<TabletEdition>;
  };
  mediaWiki?: MediaWikiEditClient;
  allowedTargets?: ReadonlySet<string>;
}

export async function saveTranscript(
  input: SaveTranscriptInput,
  dependencies: SaveTranscriptDependencies = {},
): Promise<SavedTranscript> {
  const factGrid =
    dependencies.factGrid ?? createFactGridClient({ revalidateSeconds: false });
  const mediaWiki = dependencies.mediaWiki ?? createMediaWikiEditClient();

  let edition: TabletEdition;
  try {
    // The current item and P251 statement are always resolved server-side from
    // uncached FactGrid data. No URL, page title, or operation comes from JSON.
    edition = await factGrid.resolveCurrentEdition(input.qid, input.editionId);
  } catch (error) {
    if (isTranscriptEditError(error)) throw error;
    throw error;
  }

  const allowedTargets =
    dependencies.allowedTargets ??
    parseAllowedEditTargets(process.env.FACTGRID_ALLOWED_EDIT_TARGETS);
  if (!edition.reference || !isAllowedEditTarget(edition.reference, allowedTargets)) {
    throw new TranscriptEditError(
      "target_not_allowed",
      "This exact tablet and document page are not enabled for editing in this deployment.",
      { status: 403 },
    );
  }

  const snapshot = await mediaWiki.inspectEdition(
    input.accessToken,
    edition,
    input.identity,
  );
  return mediaWiki.submitEdit(input.accessToken, snapshot, input.request);
}
