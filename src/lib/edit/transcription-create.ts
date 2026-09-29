import "server-only";

import { FACTGRID, FACTGRID_LIMITS, FACTGRID_PROPERTIES, CUNEIFORM_CATALOGUE_QID } from "@/lib/factgrid/constants";
import { validatePlainTranscriptReplacement } from "@/lib/factgrid/transcript";
import type { Qid, WikibaseEntity, WikibaseStatement } from "@/lib/factgrid/types";

import type { VerifiedEditorIdentity } from "./authorization";
import { isEditTargetEnabled } from "./targets";
import { isWikibaseEditEntityComment } from "./wikibase-comment";

type ServerFetch = typeof globalThis.fetch;

const MAX_CREATE_BODY_BYTES = FACTGRID_LIMITS.maxTranscriptBytes * 2 + 8_192;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const DEFAULT_CREATE_SUMMARY = "Add transliteration via FactGrid Cuneiform Interface";
const DEFAULT_LINK_SUMMARY = "Link transliteration document via FactGrid Cuneiform Interface";

export type TranscriptionCreationState =
  | "no_local"
  | "external_only"
  | "linked_missing"
  | "existing";

export type TranscriptionCreationErrorCode =
  | "invalid_request"
  | "edit_conflict"
  | "tablet_not_found"
  | "tablet_not_in_catalogue"
  | "identity_mismatch"
  | "account_blocked"
  | "missing_edit_right"
  | "missing_create_right"
  | "missing_create_grant"
  | "target_not_allowed"
  | "page_not_editable"
  | "entity_not_editable"
  | "existing_local_transcription"
  | "page_exists_unlinked"
  | "provider_rejected_create"
  | "provider_rejected_link"
  | "factgrid_unavailable"
  | "creation_status_unknown"
  | "creation_confirmation_failed"
  | "link_status_unknown"
  | "link_confirmation_failed";

export interface TranscriptionRecovery {
  qid: Qid;
  title: string;
  url: string;
  pageRevisionId?: number;
  nextAction: "check_page" | "link_page" | "check_link";
}

export class TranscriptionCreationError extends Error {
  readonly code: TranscriptionCreationErrorCode;
  readonly status: number;
  readonly state?: TranscriptionCreationState;
  readonly recovery?: TranscriptionRecovery;

  constructor(
    code: TranscriptionCreationErrorCode,
    message: string,
    options: {
      status: number;
      state?: TranscriptionCreationState;
      recovery?: TranscriptionRecovery;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TranscriptionCreationError";
    this.code = code;
    this.status = options.status;
    this.state = options.state;
    this.recovery = options.recovery;
  }
}

export function isTranscriptionCreationError(
  error: unknown,
): error is TranscriptionCreationError {
  return error instanceof TranscriptionCreationError;
}

export interface TranscriptionCreateRequest {
  text: string;
  summary: string;
  baseRevision?: number;
}

function invalidRequest(message: string, cause?: unknown): TranscriptionCreationError {
  return new TranscriptionCreationError("invalid_request", message, {
    status: 400,
    cause,
  });
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const [mediaType, ...parameters] = value.split(";");
  return (
    mediaType.trim().toLowerCase() === "application/json" &&
    parameters.every((parameter) => {
      const normalized = parameter.trim().toLowerCase();
      return normalized === "charset=utf-8" || normalized === 'charset="utf-8"';
    })
  );
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidRequest("The request body length is invalid.");
    }
    if (length > MAX_CREATE_BODY_BYTES) {
      throw new TranscriptionCreationError(
        "invalid_request",
        "The request body is too large.",
        { status: 413 },
      );
    }
  }
  if (!request.body) throw invalidRequest("A JSON request body is required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_CREATE_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new TranscriptionCreationError(
          "invalid_request",
          "The request body is too large.",
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (isTranscriptionCreationError(error)) throw error;
    throw invalidRequest("The request body could not be read.", error);
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function parseTranscriptionCreateRequest(
  request: Request,
): Promise<TranscriptionCreateRequest> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    throw new TranscriptionCreationError(
      "invalid_request",
      "Content-Type must be application/json with an optional UTF-8 charset.",
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      await readBoundedBody(request),
    );
    body = JSON.parse(decoded);
  } catch (error) {
    if (isTranscriptionCreationError(error)) throw error;
    throw invalidRequest("The request body must be valid UTF-8 JSON.", error);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest("The transcription creation request is invalid.");
  }
  const keys = Object.keys(body);
  if (
    keys.some(
      (key) =>
        key !== "text" &&
        key !== "summary" &&
        key !== "baseRevision",
    )
  ) {
    throw invalidRequest("The transcription creation request is invalid.");
  }
  const text = (body as { text?: unknown }).text;
  const summary = (body as { summary?: unknown }).summary;
  const baseRevision = (body as { baseRevision?: unknown }).baseRevision;
  if (typeof text !== "string" || !text.trim()) {
    throw invalidRequest("A non-empty transliteration is required.");
  }
  if (typeof summary !== "string") {
    throw invalidRequest("An edit summary is required, even when it is blank.");
  }
  if (
    summary.length > 255 ||
    CONTROL_CHARACTERS.test(summary) ||
    Buffer.byteLength(summary, "utf8") > 500
  ) {
    throw invalidRequest("The edit summary is invalid or too large.");
  }
  if (
    baseRevision !== undefined &&
    (!Number.isSafeInteger(baseRevision) || (baseRevision as number) <= 0)
  ) {
    throw invalidRequest("The base entity revision is invalid.");
  }
  try {
    validatePlainTranscriptReplacement(text);
  } catch (error) {
    throw invalidRequest("The transliteration is not supported by the plain-text editor.", error);
  }
  return {
    text,
    summary,
    ...(baseRevision === undefined ? {} : { baseRevision: baseRevision as number }),
  };
}

export interface InspectedPage {
  exists: boolean;
  title: string;
  namespace: number;
  editable: boolean;
  pageId?: number;
  revisionId?: number;
  source?: string;
  contentModel?: string;
  contentFormat?: string;
  username?: string;
  userId?: string;
  comment?: string;
}

export interface TranscriptionCreationInspection {
  qid: Qid;
  entityRevisionId: number;
  isCatalogueMember: boolean;
  p251Values: readonly string[];
  p69Values: readonly string[];
  entityEditable: boolean;
  entityRevision?: {
    revisionId?: number;
    username?: string;
    userId?: string;
    comment?: string;
  };
  page: InspectedPage;
  csrfToken: string;
  requestStartedAt: string;
}

export interface CreatedPageResult {
  revisionId: number;
}

export interface LinkedEntityResult {
  revisionId: number;
}

export interface TranscriptionCreationProvider {
  inspect(
    accessToken: string,
    qid: Qid,
    identity: VerifiedEditorIdentity,
  ): Promise<TranscriptionCreationInspection>;
  createPage(input: {
    accessToken: string;
    inspection: TranscriptionCreationInspection;
    identity: VerifiedEditorIdentity;
    title: string;
    source: string;
    summary: string;
  }): Promise<CreatedPageResult>;
  linkPage(input: {
    accessToken: string;
    inspection: TranscriptionCreationInspection;
    identity: VerifiedEditorIdentity;
    url: string;
    summary: string;
  }): Promise<LinkedEntityResult>;
}

export interface CreateTranscriptionInput {
  qid: Qid;
  accessToken: string;
  identity: VerifiedEditorIdentity;
  request: TranscriptionCreateRequest;
  contributorPolicy: "restricted" | "authenticated";
  allowedTargets: ReadonlySet<string>;
}

export interface CreatedTranscription {
  status: "created_and_linked" | "created" | "already_available";
  initialState: TranscriptionCreationState;
  title: string;
  url: string;
  pageRevisionId: number;
  entityRevisionId: number;
  text: string;
}

export interface CreateTranscriptionDependencies {
  provider?: TranscriptionCreationProvider;
}

export function transcriptionTitle(qid: Qid): string {
  return `D-${qid}`;
}

export function transcriptionUrl(qid: Qid): string {
  return `${FACTGRID.wikiBase}${transcriptionTitle(qid)}`;
}

export function buildTranscriptionSource(qid: Qid, text: string): string {
  validatePlainTranscriptReplacement(text);
  const numericQid = qid.slice(1);
  return (
    `{{Template:CuneiformInfoBox|${numericQid}}}\n\n` +
    "== Transcript ==\n" +
    '<poem property="http://www.purl.org/cuneiform/hasTransliteration">' +
    `${text}</poem>\n`
  );
}

function classifyInspection(
  inspection: TranscriptionCreationInspection,
  canonicalUrl: string,
): TranscriptionCreationState {
  const linked = inspection.p251Values.includes(canonicalUrl);
  if (linked && !inspection.page.exists) return "linked_missing";
  if (inspection.page.exists || inspection.p251Values.length > 0) return "existing";
  if (inspection.p69Values.length > 0) return "external_only";
  return "no_local";
}

function recovery(
  qid: Qid,
  revisionId: number | undefined,
  nextAction: TranscriptionRecovery["nextAction"],
): TranscriptionRecovery {
  return {
    qid,
    title: transcriptionTitle(qid),
    url: transcriptionUrl(qid),
    pageRevisionId: revisionId,
    nextAction,
  };
}

function isRecoverableOwnPage(
  inspection: TranscriptionCreationInspection,
  source: string,
  identity: VerifiedEditorIdentity,
  summary: string,
): boolean {
  return (
    inspection.page.exists &&
    Number.isSafeInteger(inspection.page.revisionId) &&
    (inspection.page.revisionId as number) > 0 &&
    inspection.page.source === source &&
    inspection.page.contentModel === "wikitext" &&
    inspection.page.contentFormat === "text/x-wiki" &&
    inspection.page.username === identity.username &&
    inspection.page.userId === identity.providerUserId &&
    inspection.page.comment === summary
  );
}

function hasConfirmedLinkAttribution(
  inspection: TranscriptionCreationInspection,
  revisionId: number,
  identity: VerifiedEditorIdentity,
): boolean {
  return (
    inspection.entityRevisionId === revisionId &&
    inspection.entityRevision?.revisionId === revisionId &&
    inspection.entityRevision.username === identity.username &&
    inspection.entityRevision.userId === identity.providerUserId &&
    isWikibaseEditEntityComment(inspection.entityRevision.comment)
  );
}

function assertInspection(
  inspection: TranscriptionCreationInspection,
  qid: Qid,
  title: string,
): void {
  if (inspection.qid !== qid || inspection.page.title !== title || inspection.page.namespace !== 0) {
    throw new TranscriptionCreationError(
      "factgrid_unavailable",
      "FactGrid returned inconsistent tablet or document metadata.",
      { status: 502 },
    );
  }
  if (!inspection.isCatalogueMember) {
    throw new TranscriptionCreationError(
      "tablet_not_in_catalogue",
      "The item is no longer part of the cuneiform tablet catalogue.",
      { status: 409 },
    );
  }
}

async function inspectForRecovery(
  provider: TranscriptionCreationProvider,
  input: CreateTranscriptionInput,
): Promise<TranscriptionCreationInspection | undefined> {
  try {
    return await provider.inspect(input.accessToken, input.qid, input.identity);
  } catch {
    return undefined;
  }
}

export async function createTranscription(
  input: CreateTranscriptionInput,
  dependencies: CreateTranscriptionDependencies = {},
): Promise<CreatedTranscription> {
  const provider = dependencies.provider ?? createTranscriptionCreationProvider();
  const title = transcriptionTitle(input.qid);
  const url = transcriptionUrl(input.qid);
  const source = buildTranscriptionSource(input.qid, input.request.text);
  const createSummary = input.request.summary.trim() || DEFAULT_CREATE_SUMMARY;

  // Policy is evaluated only against the exact server-derived destination. The
  // browser never supplies a title, host, or reference that could broaden it.
  if (
    !isEditTargetEnabled(
      { kind: "d", qid: input.qid, title, url },
      input.contributorPolicy,
      input.allowedTargets,
    )
  ) {
    throw new TranscriptionCreationError(
      "target_not_allowed",
      "This exact tablet and derived document page are not enabled for creation in this deployment.",
      { status: 403 },
    );
  }

  let inspection = await provider.inspect(input.accessToken, input.qid, input.identity);
  assertInspection(inspection, input.qid, title);
  if (
    input.request.baseRevision !== undefined &&
    inspection.entityRevisionId !== input.request.baseRevision
  ) {
    throw new TranscriptionCreationError(
      "edit_conflict",
      "FactGrid has a newer tablet revision than the one opened in the editor.",
      { status: 409 },
    );
  }
  const initialState = classifyInspection(inspection, url);
  const linkedInitially = inspection.p251Values.includes(url);

  if (inspection.page.exists && linkedInitially) {
    if (!Number.isSafeInteger(inspection.page.revisionId) || (inspection.page.revisionId as number) <= 0) {
      throw new TranscriptionCreationError(
        "factgrid_unavailable",
        "FactGrid did not identify the existing document revision.",
        { status: 502, state: initialState },
      );
    }
    if (inspection.page.source !== source) {
      throw new TranscriptionCreationError(
        "existing_local_transcription",
        "The linked FactGrid transcription already exists with different content. Your draft was not saved.",
        { status: 409, state: initialState },
      );
    }
    return {
      status: "already_available",
      initialState,
      title,
      url,
      pageRevisionId: inspection.page.revisionId as number,
      entityRevisionId: inspection.entityRevisionId,
      text: input.request.text,
    };
  }

  if (inspection.p251Values.length > 0 && !linkedInitially) {
    throw new TranscriptionCreationError(
      "existing_local_transcription",
      "This tablet already has a local FactGrid document. It was not replaced or supplemented automatically.",
      { status: 409, state: initialState },
    );
  }

  if (!linkedInitially && !inspection.entityEditable && !inspection.page.exists) {
    throw new TranscriptionCreationError(
      "entity_not_editable",
      "FactGrid does not currently permit this account to link a new document to the tablet.",
      { status: 403, state: initialState },
    );
  }

  let pageRevisionId: number;
  if (inspection.page.exists) {
    if (!isRecoverableOwnPage(inspection, source, input.identity, createSummary)) {
      throw new TranscriptionCreationError(
        "page_exists_unlinked",
        "The derived FactGrid document page already exists but is not linked to this tablet. It was not overwritten or adopted.",
        {
          status: 409,
          state: initialState,
          recovery: recovery(input.qid, inspection.page.revisionId, "check_page"),
        },
      );
    }
    pageRevisionId = inspection.page.revisionId as number;
  } else {
    if (!inspection.page.editable) {
      throw new TranscriptionCreationError(
        "page_not_editable",
        "FactGrid does not currently permit this account to create the derived document page.",
        { status: 403, state: initialState },
      );
    }

    let created: CreatedPageResult;
    let recoveredConcurrentPage = false;
    try {
      created = await provider.createPage({
        accessToken: input.accessToken,
        inspection,
        identity: input.identity,
        title,
        source,
        summary: createSummary,
      });
    } catch (error) {
      if (isTranscriptionCreationError(error) && error.code === "page_exists_unlinked") {
        const concurrent = await inspectForRecovery(provider, input);
        if (
          concurrent &&
          isRecoverableOwnPage(concurrent, source, input.identity, createSummary)
        ) {
          inspection = concurrent;
          pageRevisionId = concurrent.page.revisionId as number;
          created = { revisionId: pageRevisionId };
          recoveredConcurrentPage = true;
        } else {
          throw error;
        }
      } else if (
        isTranscriptionCreationError(error) &&
        error.code === "creation_status_unknown"
      ) {
        throw new TranscriptionCreationError(error.code, error.message, {
          status: error.status,
          state: initialState,
          recovery: recovery(input.qid, undefined, "check_page"),
          cause: error,
        });
      } else {
        throw error;
      }
    }

    pageRevisionId = created.revisionId;
    if (!recoveredConcurrentPage) {
      let confirmed: TranscriptionCreationInspection;
      try {
        confirmed = await provider.inspect(input.accessToken, input.qid, input.identity);
      } catch (cause) {
        throw new TranscriptionCreationError(
          "creation_confirmation_failed",
          "FactGrid accepted the page creation, but the new document could not be read back. Check the page before trying again.",
          {
            status: 502,
            state: initialState,
            recovery: recovery(input.qid, pageRevisionId, "check_page"),
            cause,
          },
        );
      }
      try {
        assertInspection(confirmed, input.qid, title);
      } catch (cause) {
        throw new TranscriptionCreationError(
          "creation_confirmation_failed",
          "FactGrid accepted the page creation, but the returned document metadata could not be confirmed. Check the page before trying again.",
          {
            status: 502,
            state: initialState,
            recovery: recovery(input.qid, pageRevisionId, "check_page"),
            cause,
          },
        );
      }
      if (
        !confirmed.page.exists ||
        confirmed.page.revisionId !== pageRevisionId ||
        confirmed.page.source !== source ||
        confirmed.page.contentModel !== "wikitext" ||
        confirmed.page.contentFormat !== "text/x-wiki" ||
        confirmed.page.username !== input.identity.username ||
        confirmed.page.userId !== input.identity.providerUserId ||
        confirmed.page.comment !== createSummary
      ) {
        throw new TranscriptionCreationError(
          "creation_confirmation_failed",
          "FactGrid accepted the page creation, but the current document does not match the confirmed result. Check the page before trying again.",
          {
            status: 409,
            state: initialState,
            recovery: recovery(input.qid, pageRevisionId, "check_page"),
          },
        );
      }
      inspection = confirmed;
    }
  }

  if (inspection.p251Values.includes(url)) {
    return {
      status: "created",
      initialState,
      title,
      url,
      pageRevisionId,
      entityRevisionId: inspection.entityRevisionId,
      text: input.request.text,
    };
  }

  if (!inspection.entityEditable) {
    throw new TranscriptionCreationError(
      "entity_not_editable",
      "The document was created, but FactGrid does not currently permit this account to link it to the tablet.",
      {
        status: 403,
        state: initialState,
        recovery: recovery(input.qid, pageRevisionId, "link_page"),
      },
    );
  }

  const linkSummary = DEFAULT_LINK_SUMMARY;
  let linked: LinkedEntityResult;
  try {
    linked = await provider.linkPage({
      accessToken: input.accessToken,
      inspection,
      identity: input.identity,
      url,
      summary: linkSummary,
    });
  } catch (error) {
    if (
      isTranscriptionCreationError(error) &&
      (error.code === "link_status_unknown" ||
        (error.code === "provider_rejected_link" && error.status === 409))
    ) {
      const reconciled = await inspectForRecovery(provider, input);
      if (reconciled?.p251Values.includes(url)) {
        try {
          assertInspection(reconciled, input.qid, title);
          return {
            status: hasConfirmedLinkAttribution(
              reconciled,
              reconciled.entityRevisionId,
              input.identity,
            )
              ? "created_and_linked"
              : "already_available",
            initialState,
            title,
            url,
            pageRevisionId,
            entityRevisionId: reconciled.entityRevisionId,
            text: input.request.text,
          };
        } catch {
          // Keep the original uncertain/conflict outcome when reconciliation
          // does not describe the exact tablet and derived document target.
        }
      }
    }
    if (isTranscriptionCreationError(error) && error.recovery) throw error;
    throw new TranscriptionCreationError(
      isTranscriptionCreationError(error) ? error.code : "provider_rejected_link",
      isTranscriptionCreationError(error)
        ? error.message
        : "The document was created, but FactGrid did not link it to the tablet.",
      {
        status: isTranscriptionCreationError(error) ? error.status : 502,
        state: initialState,
        recovery: recovery(
          input.qid,
          pageRevisionId,
          isTranscriptionCreationError(error) && error.code === "link_status_unknown"
            ? "check_link"
            : "link_page",
        ),
        cause: error,
      },
    );
  }

  let confirmedLink: TranscriptionCreationInspection;
  try {
    confirmedLink = await provider.inspect(input.accessToken, input.qid, input.identity);
  } catch (cause) {
    throw new TranscriptionCreationError(
      "link_confirmation_failed",
      "The document was created and FactGrid accepted the link, but the entity could not be read back. Check the tablet before trying again.",
      {
        status: 502,
        state: initialState,
        recovery: recovery(input.qid, pageRevisionId, "check_link"),
        cause,
      },
    );
  }
  try {
    assertInspection(confirmedLink, input.qid, title);
  } catch (cause) {
    throw new TranscriptionCreationError(
      "link_confirmation_failed",
      "FactGrid accepted the link, but the returned tablet metadata could not be confirmed. Check the tablet before trying again.",
      {
        status: 502,
        state: initialState,
        recovery: recovery(input.qid, pageRevisionId, "check_link"),
        cause,
      },
    );
  }
  if (
    !confirmedLink.p251Values.includes(url) ||
    !hasConfirmedLinkAttribution(confirmedLink, linked.revisionId, input.identity)
  ) {
    throw new TranscriptionCreationError(
      "link_confirmation_failed",
      "FactGrid accepted the link, but the current tablet entity does not match the confirmed result. Check the tablet before trying again.",
      {
        status: 409,
        state: initialState,
        recovery: recovery(input.qid, pageRevisionId, "check_link"),
      },
    );
  }

  return {
    status: "created_and_linked",
    initialState,
    title,
    url,
    pageRevisionId,
    entityRevisionId: confirmedLink.entityRevisionId,
    text: input.request.text,
  };
}

interface MediaWikiUserInfo {
  id?: number;
  name?: string;
  anon?: boolean;
  rights?: string[];
  blockid?: number;
  blockedby?: string;
  blockreason?: string;
  blockexpiry?: string;
}

interface MediaWikiPageInspection {
  pageid?: number;
  ns?: number;
  title?: string;
  missing?: boolean;
  invalid?: boolean;
  actions?: { edit?: boolean };
  revisions?: Array<{
    revid?: number;
    user?: string;
    userid?: number;
    comment?: string;
    slots?: {
      main?: { contentmodel?: string; contentformat?: string; content?: string };
    };
  }>;
}

interface InspectQueryResponse {
  error?: { code?: string; info?: string };
  curtimestamp?: string;
  query?: {
    userinfo?: MediaWikiUserInfo;
    tokens?: { csrftoken?: string };
    pages?: MediaWikiPageInspection[];
  };
}

interface EntityResponse {
  error?: { code?: string; info?: string };
  entities?: Record<string, WikibaseEntity>;
}

interface MutationResponse {
  error?: { code?: string; info?: string };
  edit?: { result?: string; title?: string; newrevid?: number };
  entity?: WikibaseEntity;
}

export interface TranscriptionCreationProviderOptions {
  fetch?: ServerFetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  authorizationHeader?: (
    accessToken: string,
    method: "GET" | "POST",
    url: URL,
    body?: URLSearchParams,
  ) => string;
}

function providerError(
  message: string,
  cause?: unknown,
): TranscriptionCreationError {
  return new TranscriptionCreationError("factgrid_unavailable", message, {
    status: 502,
    cause,
  });
}

async function boundedJson<T>(response: Response, maximum: number): Promise<T> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw providerError("FactGrid returned an unexpectedly large response.");
  }
  if (!response.body) throw providerError("FactGrid returned an empty response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => undefined);
        throw providerError("FactGrid returned an unexpectedly large response.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
  } catch (cause) {
    throw providerError("FactGrid returned an invalid response.", cause);
  }
}

function activeStringValues(entity: WikibaseEntity, property: string): string[] {
  const statements = entity.claims?.[property];
  if (!Array.isArray(statements)) return [];
  return statements
    .filter((statement) => statement.rank !== "deprecated")
    .map((statement) => statement.mainsnak)
    .filter(
      (snak) =>
        snak?.snaktype === "value" &&
        typeof snak.datavalue?.value === "string",
    )
    .map((snak) => snak?.datavalue?.value as string);
}

function hasEntityValue(entity: WikibaseEntity, property: string, qid: string): boolean {
  const statements = entity.claims?.[property];
  return (
    Array.isArray(statements) &&
    statements.some((statement) => {
      if (statement.rank === "deprecated" || statement.mainsnak?.snaktype !== "value") {
        return false;
      }
      const value = statement.mainsnak.datavalue?.value;
      return !!value && typeof value === "object" && "id" in value && value.id === qid;
    })
  );
}

function hasBlockInfo(userinfo: MediaWikiUserInfo): boolean {
  return (
    "blockid" in userinfo ||
    "blockedby" in userinfo ||
    "blockreason" in userinfo ||
    "blockexpiry" in userinfo
  );
}

function mutationError(
  stage: "create" | "link",
  error: MutationResponse["error"],
): TranscriptionCreationError {
  const code = error?.code ?? "unknown";
  if (stage === "create" && ["articleexists", "edit-already-exists"].includes(code)) {
    return new TranscriptionCreationError(
      "page_exists_unlinked",
      "The derived document page was created concurrently or already exists.",
      { status: 409 },
    );
  }
  if (code === "badtoken" || code === "assertuserfailed" || code === "notloggedin") {
    return new TranscriptionCreationError(
      "identity_mismatch",
      "The FactGrid session is no longer valid. Sign in again.",
      { status: 401 },
    );
  }
  if (
    ["blocked", "autoblocked", "protectedpage", "permissiondenied", "cantcreate"]
      .some((prefix) => code === prefix || code.startsWith(`${prefix}-`))
  ) {
    return new TranscriptionCreationError(
      stage === "create" ? "page_not_editable" : "entity_not_editable",
      `FactGrid does not currently permit this account to ${stage} the transcription.`,
      { status: 403 },
    );
  }
  if (stage === "link" && ["editconflict", "failed-save"].includes(code)) {
    return new TranscriptionCreationError(
      "provider_rejected_link",
      "The document was created, but the tablet changed before it could be linked. Reconcile the link from the current tablet revision.",
      { status: 409 },
    );
  }
  return new TranscriptionCreationError(
    stage === "create" ? "provider_rejected_create" : "provider_rejected_link",
    `FactGrid rejected the transcription ${stage} operation.`,
    { status: code === "ratelimited" || code === "maxlag" ? 503 : 422 },
  );
}

export function createTranscriptionCreationProvider(
  options: TranscriptionCreationProviderOptions = {},
): TranscriptionCreationProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? FACTGRID_LIMITS.timeoutMs;
  const maxResponseBytes = options.maxResponseBytes ?? FACTGRID_LIMITS.maxResponseBytes;
  if (typeof fetchImpl !== "function") throw providerError("Server fetch is unavailable.");

  async function getJson<T>(parameters: Record<string, string>, accessToken: string): Promise<T> {
    const url = new URL(FACTGRID.api);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: options.authorizationHeader
            ? options.authorizationHeader(accessToken, "GET", url)
            : `Bearer ${accessToken}`,
          "User-Agent": "FactGrid-Cuneiform-Interface/0.1 (transcript creator)",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw providerError("FactGrid could not be reached.", cause);
    }
    if (!response.ok) throw providerError(`FactGrid returned HTTP ${response.status}.`);
    return boundedJson<T>(response, maxResponseBytes);
  }

  async function postJson<T>(
    parameters: URLSearchParams,
    accessToken: string,
    stage: "create" | "link",
  ): Promise<T> {
    const url = new URL(FACTGRID.api);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: options.authorizationHeader
            ? options.authorizationHeader(accessToken, "POST", url, parameters)
            : `Bearer ${accessToken}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "FactGrid-Cuneiform-Interface/0.1 (transcript creator)",
        },
        body: parameters,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new TranscriptionCreationError(
        stage === "create" ? "creation_status_unknown" : "link_status_unknown",
        `The connection ended before FactGrid confirmed the ${stage} operation. Do not retry blindly.`,
        { status: 502, cause },
      );
    }
    if (!response.ok) {
      throw new TranscriptionCreationError(
        stage === "create" ? "creation_status_unknown" : "link_status_unknown",
        `FactGrid did not return a conclusive ${stage} response. Do not retry blindly.`,
        { status: 502 },
      );
    }
    try {
      return await boundedJson<T>(response, maxResponseBytes);
    } catch (cause) {
      throw new TranscriptionCreationError(
        stage === "create" ? "creation_status_unknown" : "link_status_unknown",
        `FactGrid returned an inconclusive ${stage} response. Do not retry blindly.`,
        { status: 502, cause },
      );
    }
  }

  async function inspect(
    accessToken: string,
    qid: Qid,
    identity: VerifiedEditorIdentity,
  ): Promise<TranscriptionCreationInspection> {
    const title = transcriptionTitle(qid);
    const [query, entityResponse] = await Promise.all([
      getJson<InspectQueryResponse>(
        {
          action: "query",
          format: "json",
          formatversion: "2",
          curtimestamp: "1",
          meta: "userinfo|tokens",
          uiprop: "blockinfo|rights",
          type: "csrf",
          prop: "info|revisions",
          inprop: "protection",
          intestactions: "edit",
          intestactionsdetail: "boolean",
          intestactionsautocreate: "1",
          rvlimit: "1",
          rvprop: "ids|user|userid|comment|content|contentmodel",
          rvslots: "main",
          titles: `Item:${qid}|${title}`,
        },
        accessToken,
      ),
      getJson<EntityResponse>(
        {
          action: "wbgetentities",
          format: "json",
          formatversion: "2",
          ids: qid,
          props: "info|claims",
        },
        accessToken,
      ),
    ]);
    if (query.error || entityResponse.error) {
      throw providerError("FactGrid rejected the transcription inspection.");
    }
    const userinfo = query.query?.userinfo;
    if (
      !userinfo ||
      userinfo.anon ||
      String(userinfo.id) !== identity.providerUserId ||
      userinfo.name !== identity.username
    ) {
      throw new TranscriptionCreationError(
        "identity_mismatch",
        "The authenticated FactGrid API identity did not match this session. Sign in again.",
        { status: 401 },
      );
    }
    if (hasBlockInfo(userinfo)) {
      throw new TranscriptionCreationError(
        "account_blocked",
        "This FactGrid account is currently blocked from editing.",
        { status: 403 },
      );
    }
    if (!userinfo.rights?.includes("edit")) {
      throw new TranscriptionCreationError(
        "missing_edit_right",
        "This FactGrid account does not currently have the edit right.",
        { status: 403 },
      );
    }
    const entity = entityResponse.entities?.[qid];
    if (!entity || entity.missing) {
      throw new TranscriptionCreationError(
        "tablet_not_found",
        "The requested tablet was not found.",
        { status: 404 },
      );
    }
    if (!Number.isSafeInteger(entity.lastrevid) || (entity.lastrevid as number) <= 0) {
      throw providerError("FactGrid did not return the current tablet revision.");
    }

    const pages = query.query?.pages;
    const entityPage = pages?.find((page) => page.title === `Item:${qid}`);
    const documentPage = pages?.find((page) => page.title === title);
    if (!entityPage || !documentPage || entityPage.missing || entityPage.invalid) {
      throw providerError("FactGrid did not return the expected tablet and document pages.");
    }
    if (documentPage.ns !== 0 || documentPage.invalid) {
      throw providerError("FactGrid returned an invalid derived document target.");
    }
    if (documentPage.missing === true && !userinfo.rights.includes("createpage")) {
      throw new TranscriptionCreationError(
        "missing_create_right",
        "This FactGrid account does not currently have the create-page right required for a new transcription.",
        { status: 403 },
      );
    }
    const csrfToken = query.query?.tokens?.csrftoken;
    if (!csrfToken || csrfToken === "+\\" || csrfToken.length > 512) {
      throw new TranscriptionCreationError(
        "identity_mismatch",
        "FactGrid did not issue an authenticated edit token. Sign in again.",
        { status: 401 },
      );
    }
    if (!query.curtimestamp || !Number.isFinite(Date.parse(query.curtimestamp))) {
      throw providerError("FactGrid did not return a valid request timestamp.");
    }

    const revision = documentPage.revisions?.[0];
    const entityRevision = entityPage.revisions?.[0];
    return {
      qid,
      entityRevisionId: entity.lastrevid as number,
      isCatalogueMember: hasEntityValue(
        entity,
        FACTGRID_PROPERTIES.membership,
        CUNEIFORM_CATALOGUE_QID,
      ),
      p251Values: activeStringValues(entity, FACTGRID_PROPERTIES.documentPage),
      p69Values: activeStringValues(entity, FACTGRID_PROPERTIES.onlineTranscript),
      entityEditable: entityPage.actions?.edit === true,
      entityRevision: {
        revisionId: entityRevision?.revid,
        username: entityRevision?.user,
        userId: entityRevision?.userid === undefined ? undefined : String(entityRevision.userid),
        comment: entityRevision?.comment,
      },
      page: {
        exists: documentPage.missing !== true,
        title,
        namespace: documentPage.ns,
        editable: documentPage.actions?.edit === true,
        pageId: documentPage.pageid,
        revisionId: revision?.revid,
        source: revision?.slots?.main?.content,
        contentModel: revision?.slots?.main?.contentmodel,
        contentFormat: revision?.slots?.main?.contentformat,
        username: revision?.user,
        userId: revision?.userid === undefined ? undefined : String(revision.userid),
        comment: revision?.comment,
      },
      csrfToken,
      requestStartedAt: query.curtimestamp,
    };
  }

  async function createPage(input: {
    accessToken: string;
    inspection: TranscriptionCreationInspection;
    identity: VerifiedEditorIdentity;
    title: string;
    source: string;
    summary: string;
  }): Promise<CreatedPageResult> {
    const parameters = new URLSearchParams({
      action: "edit",
      format: "json",
      formatversion: "2",
      assert: "user",
      title: input.title,
      text: input.source,
      token: input.inspection.csrfToken,
      summary: input.summary,
      createonly: "1",
      starttimestamp: input.inspection.requestStartedAt,
      contentmodel: "wikitext",
      watchlist: "nochange",
    });
    const response = await postJson<MutationResponse>(parameters, input.accessToken, "create");
    if (response.error) throw mutationError("create", response.error);
    if (
      response.edit?.result !== "Success" ||
      response.edit.title !== input.title ||
      !Number.isSafeInteger(response.edit.newrevid) ||
      (response.edit.newrevid as number) <= 0
    ) {
      throw new TranscriptionCreationError(
        "creation_status_unknown",
        "FactGrid returned an inconclusive page-creation result. Check the page before trying again.",
        { status: 502 },
      );
    }
    return { revisionId: response.edit.newrevid as number };
  }

  async function linkPage(input: {
    accessToken: string;
    inspection: TranscriptionCreationInspection;
    identity: VerifiedEditorIdentity;
    url: string;
    summary: string;
  }): Promise<LinkedEntityResult> {
    if (input.inspection.p251Values.includes(input.url)) {
      return { revisionId: input.inspection.entityRevisionId };
    }
    const statement: WikibaseStatement & { type: "statement"; rank: "normal" } = {
      type: "statement",
      rank: "normal",
      mainsnak: {
        snaktype: "value",
        property: FACTGRID_PROPERTIES.documentPage,
        datatype: "url",
        datavalue: { type: "string", value: input.url },
      },
    };
    const parameters = new URLSearchParams({
      action: "wbeditentity",
      format: "json",
      formatversion: "2",
      assert: "user",
      id: input.inspection.qid,
      baserevid: String(input.inspection.entityRevisionId),
      token: input.inspection.csrfToken,
      summary: input.summary,
      data: JSON.stringify({ claims: [statement] }),
    });
    const response = await postJson<MutationResponse>(parameters, input.accessToken, "link");
    if (response.error) throw mutationError("link", response.error);
    if (
      response.entity?.id !== input.inspection.qid ||
      !Number.isSafeInteger(response.entity.lastrevid) ||
      (response.entity.lastrevid as number) <= input.inspection.entityRevisionId
    ) {
      throw new TranscriptionCreationError(
        "link_status_unknown",
        "FactGrid returned an inconclusive document-link result. Check the tablet before trying again.",
        { status: 502 },
      );
    }
    return { revisionId: response.entity.lastrevid as number };
  }

  return Object.freeze({ inspect, createPage, linkPage });
}
