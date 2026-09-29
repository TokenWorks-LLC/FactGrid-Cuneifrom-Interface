import "server-only";

import { FACTGRID, FACTGRID_LIMITS, FACTGRID_PROPERTIES } from "@/lib/factgrid/constants";
import { createFactGridClient } from "@/lib/factgrid/server";
import type {
  EditableTabletEntity,
  PropertyId,
  Qid,
  WikibaseEntity,
  WikibaseReference,
  WikibaseSnak,
  WikibaseStatement,
} from "@/lib/factgrid/types";

import type { VerifiedEditorIdentity } from "./authorization";
import { TranscriptEditError, isTranscriptEditError } from "./errors";
import type {
  MetadataOperation,
  MetadataSnak,
  MetadataStatement,
  MetadataValue,
  MetadataWriteRequest,
} from "./metadata-request";
import { isWikibaseEditEntityComment } from "./wikibase-comment";

type ServerFetch = typeof globalThis.fetch;

interface MediaWikiUserInfo {
  id?: number;
  name?: string;
  anon?: boolean;
  blockid?: number;
  blockedby?: string;
  blockreason?: string;
  blockexpiry?: string;
  rights?: string[];
}

interface InspectResponse {
  error?: { code?: string; info?: string };
  curtimestamp?: string;
  query?: {
    userinfo?: MediaWikiUserInfo;
    tokens?: { csrftoken?: string };
    pages?: Array<{
      pageid?: number;
      ns?: number;
      title?: string;
      missing?: boolean;
      invalid?: boolean;
      actions?: { edit?: boolean };
    }>;
  };
}

interface EntityEditResponse {
  success?: number;
  error?: { code?: string; info?: string };
  entity?: WikibaseEntity;
}

interface RevisionResponse {
  error?: { code?: string; info?: string };
  query?: {
    pages?: Array<{
      pageid?: number;
      ns?: number;
      title?: string;
      revisions?: Array<{
        revid?: number;
        user?: string;
        userid?: number;
        comment?: string;
      }>;
    }>;
  };
}

export interface MetadataInspection {
  csrfToken: string;
  requestStartedAt: string;
  expectedUsername: string;
  expectedUserId: string;
}

export interface MetadataMutationClient {
  inspect(
    accessToken: string,
    qid: Qid,
    identity: VerifiedEditorIdentity,
  ): Promise<MetadataInspection>;
  submit(
    accessToken: string,
    qid: Qid,
    baseRevision: number,
    summary: string,
    patch: Record<string, unknown>,
    inspection: MetadataInspection,
  ): Promise<number>;
  confirmAttribution(
    accessToken: string,
    qid: Qid,
    revisionId: number,
    summary: string,
    inspection: MetadataInspection,
  ): Promise<void>;
}

export interface MetadataMutationClientOptions {
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

function metadataError(
  code: ConstructorParameters<typeof TranscriptEditError>[0],
  message: string,
  status: number,
  cause?: unknown,
): TranscriptEditError {
  return new TranscriptEditError(code, message, { status, cause });
}

async function boundedJson<T>(response: Response, maximum: number): Promise<T> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum) {
    throw metadataError("factgrid_unavailable", "FactGrid returned an unexpectedly large response.", 502);
  }
  if (!response.body) {
    throw metadataError("factgrid_unavailable", "FactGrid returned an empty response.", 502);
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
      if (total > maximum) {
        await reader.cancel().catch(() => undefined);
        throw metadataError("factgrid_unavailable", "FactGrid returned an unexpectedly large response.", 502);
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
    throw metadataError("factgrid_unavailable", "FactGrid returned an invalid response.", 502, cause);
  }
}

function assertTrustedApiUrl(url: URL): void {
  if (
    url.origin !== FACTGRID.origin ||
    url.pathname !== new URL(FACTGRID.api).pathname ||
    url.username ||
    url.password
  ) {
    throw metadataError("invalid_request", "Refused an untrusted FactGrid endpoint.", 500);
  }
}

function hasBlockInfo(user: MediaWikiUserInfo): boolean {
  return ["blockid", "blockedby", "blockreason", "blockexpiry"].some((key) => key in user);
}

function verifyApiIdentity(
  user: MediaWikiUserInfo | undefined,
  identity: VerifiedEditorIdentity,
): void {
  if (
    !user ||
    user.anon === true ||
    typeof user.id !== "number" ||
    String(user.id) !== identity.providerUserId ||
    user.name !== identity.username
  ) {
    throw metadataError(
      "identity_mismatch",
      "The authenticated FactGrid API identity did not match this session. Sign in again.",
      401,
    );
  }
  if (hasBlockInfo(user)) {
    throw metadataError("account_blocked", "This FactGrid account is currently blocked from editing.", 403);
  }
  if (!Array.isArray(user.rights) || !user.rights.includes("edit")) {
    throw metadataError("missing_edit_right", "This FactGrid account cannot edit the tablet item.", 403);
  }
}

function providerEditError(error: EntityEditResponse["error"]): TranscriptEditError {
  const code = error?.code ?? "unknown";
  if (["editconflict", "pagedeleted", "edit-already-exists", "edit-gone-missing"].includes(code)) {
    return metadataError(
      "edit_conflict",
      "FactGrid has a newer version of this tablet. Reload before saving again.",
      409,
    );
  }
  if (["badtoken", "assertuserfailed", "notloggedin"].includes(code)) {
    return metadataError("identity_mismatch", "The FactGrid session is no longer valid. Sign in again.", 401);
  }
  if (
    ["blocked", "autoblocked", "protectedpage", "permissiondenied"].some(
      (prefix) => code === prefix || code.startsWith(`${prefix}-`),
    )
  ) {
    return metadataError("page_not_editable", "FactGrid does not permit this metadata edit.", 403);
  }
  if (code === "ratelimited" || code === "maxlag") {
    return metadataError("provider_rejected_edit", "FactGrid is busy and did not accept the edit.", 503);
  }
  return metadataError(
    "provider_rejected_edit",
    "FactGrid rejected the metadata edit. The draft has not been cleared.",
    422,
  );
}

export function createMetadataMutationClient(
  options: MetadataMutationClientOptions = {},
): MetadataMutationClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? FACTGRID_LIMITS.timeoutMs;
  const maximum = options.maxResponseBytes ?? FACTGRID_LIMITS.maxResponseBytes;

  async function request<T>(
    method: "GET" | "POST",
    parameters: URLSearchParams,
    accessToken: string,
    ambiguousWrite = false,
  ): Promise<T> {
    const url = new URL(FACTGRID.api);
    const body = method === "POST" ? parameters : undefined;
    if (method === "GET") {
      for (const [key, value] of parameters) url.searchParams.append(key, value);
    }
    assertTrustedApiUrl(url);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: options.authorizationHeader
            ? options.authorizationHeader(accessToken, method, url, body)
            : `Bearer ${accessToken}`,
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : {}),
          "User-Agent": "FactGrid-Cuneiform-Interface/0.1 (metadata editor)",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw metadataError(
        ambiguousWrite ? "save_status_unknown" : "factgrid_unavailable",
        ambiguousWrite
          ? "The connection ended before FactGrid confirmed the metadata edit. Check item history before retrying."
          : "FactGrid could not be reached.",
        502,
        cause,
      );
    }
    if (!response.ok) {
      throw metadataError(
        ambiguousWrite ? "save_status_unknown" : "factgrid_unavailable",
        ambiguousWrite
          ? "FactGrid did not return a conclusive metadata edit response. Check item history before retrying."
          : `FactGrid returned HTTP ${response.status}.`,
        502,
      );
    }
    try {
      return await boundedJson<T>(response, maximum);
    } catch (cause) {
      if (!ambiguousWrite && isTranscriptEditError(cause)) throw cause;
      throw metadataError(
        ambiguousWrite ? "save_status_unknown" : "factgrid_unavailable",
        ambiguousWrite
          ? "FactGrid returned an inconclusive metadata response. Check item history before retrying."
          : "FactGrid returned an invalid response.",
        502,
        cause,
      );
    }
  }

  async function inspect(
    accessToken: string,
    qid: Qid,
    identity: VerifiedEditorIdentity,
  ): Promise<MetadataInspection> {
    const response = await request<InspectResponse>(
      "GET",
      new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        curtimestamp: "1",
        meta: "userinfo|tokens",
        uiprop: "blockinfo|groups|rights",
        type: "csrf",
        prop: "info",
        inprop: "protection",
        intestactions: "edit",
        intestactionsdetail: "boolean",
        titles: `Item:${qid}`,
      }),
      accessToken,
    );
    if (response.error) throw metadataError("factgrid_unavailable", "FactGrid rejected item inspection.", 502);
    verifyApiIdentity(response.query?.userinfo, identity);
    const pages = response.query?.pages;
    const page = Array.isArray(pages) && pages.length === 1 ? pages[0] : undefined;
    if (
      !page ||
      page.missing ||
      page.invalid ||
      page.ns !== 120 ||
      page.title !== `Item:${qid}` ||
      page.actions?.edit !== true
    ) {
      throw metadataError("page_not_editable", "FactGrid does not permit this account to edit the tablet item.", 403);
    }
    const csrfToken = response.query?.tokens?.csrftoken;
    if (typeof csrfToken !== "string" || csrfToken.length < 8 || csrfToken.length > 512 || csrfToken === "+\\") {
      throw metadataError("identity_mismatch", "FactGrid did not issue an authenticated edit token.", 401);
    }
    if (typeof response.curtimestamp !== "string" || !Number.isFinite(Date.parse(response.curtimestamp))) {
      throw metadataError("factgrid_unavailable", "FactGrid did not return a valid request timestamp.", 502);
    }
    return {
      csrfToken,
      requestStartedAt: response.curtimestamp,
      expectedUsername: identity.username,
      expectedUserId: identity.providerUserId,
    };
  }

  async function submit(
    accessToken: string,
    qid: Qid,
    baseRevision: number,
    summary: string,
    patch: Record<string, unknown>,
    inspection: MetadataInspection,
  ): Promise<number> {
    const effectiveSummary = summary.trim() || "Update tablet metadata via FactGrid Cuneiform Interface";
    const response = await request<EntityEditResponse>(
      "POST",
      new URLSearchParams({
        action: "wbeditentity",
        format: "json",
        formatversion: "2",
        assert: "user",
        id: qid,
        baserevid: String(baseRevision),
        summary: effectiveSummary,
        token: inspection.csrfToken,
        data: JSON.stringify(patch),
      }),
      accessToken,
      true,
    );
    if (response.error) throw providerEditError(response.error);
    const revisionId = response.entity?.lastrevid;
    if (response.success !== 1 || !Number.isSafeInteger(revisionId) || (revisionId as number) <= 0) {
      throw metadataError(
        "save_status_unknown",
        "FactGrid returned an inconclusive metadata result. Check item history before retrying.",
        502,
      );
    }
    return revisionId as number;
  }

  async function confirmAttribution(
    accessToken: string,
    qid: Qid,
    revisionId: number,
    _summary: string,
    inspection: MetadataInspection,
  ): Promise<void> {
    const response = await request<RevisionResponse>(
      "GET",
      new URLSearchParams({
        action: "query",
        format: "json",
        formatversion: "2",
        prop: "revisions",
        rvlimit: "1",
        rvprop: "ids|user|userid|comment",
        titles: `Item:${qid}`,
      }),
      accessToken,
    );
    const pages = response.query?.pages;
    const page = Array.isArray(pages) && pages.length === 1 ? pages[0] : undefined;
    const revision = page?.revisions?.[0];
    if (
      response.error ||
      page?.ns !== 120 ||
      page.title !== `Item:${qid}` ||
      page.revisions?.length !== 1 ||
      revision?.revid !== revisionId ||
      revision.user !== inspection.expectedUsername ||
      String(revision.userid) !== inspection.expectedUserId ||
      !isWikibaseEditEntityComment(revision.comment)
    ) {
      throw metadataError(
        "save_confirmation_failed",
        "FactGrid accepted the edit, but its current revision or attribution could not be confirmed.",
        409,
      );
    }
  }

  return Object.freeze({ inspect, submit, confirmAttribution });
}

function propertyIdsForOperations(operations: readonly MetadataOperation[]): PropertyId[] {
  const result = new Set<PropertyId>();
  const addSnak = (snak: MetadataSnak) => result.add(snak.property as PropertyId);
  for (const operation of operations) {
    if (operation.type !== "upsert-statement") continue;
    addSnak(operation.statement.mainsnak);
    for (const snaks of Object.values(operation.statement.qualifiers)) {
      for (const snak of snaks) addSnak(snak);
    }
    for (const reference of operation.statement.references) {
      for (const snaks of Object.values(reference.snaks)) {
        for (const snak of snaks) addSnak(snak);
      }
    }
  }
  return [...result];
}

function expectedValueKind(datatype: string): MetadataValue["kind"] | undefined {
  if (["string", "external-id", "url", "commonsMedia", "geo-shape", "tabular-data"].includes(datatype)) {
    return "string";
  }
  if (datatype.startsWith("wikibase-")) return "entity";
  if (datatype === "monolingualtext") return "monolingualtext";
  if (datatype === "time") return "time";
  if (datatype === "quantity") return "quantity";
  if (datatype === "globe-coordinate") return "coordinate";
  return undefined;
}

function expectedEntityType(datatype: string): string | undefined {
  return datatype.startsWith("wikibase-") ? datatype.slice("wikibase-".length) : undefined;
}

function assertSafeContentUrl(value: string, label: string): void {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("unsafe");
  } catch {
    throw metadataError("invalid_request", `${label} must be a safe HTTP or HTTPS URL.`, 400);
  }
}

function assertSnak(
  snak: MetadataSnak,
  snapshot: EditableTabletEntity,
  mapProperty?: string,
): void {
  if (mapProperty && snak.property !== mapProperty) {
    throw metadataError("invalid_request", "A qualifier or reference snak used the wrong property key.", 400);
  }
  if (snak.property === FACTGRID_PROPERTIES.documentPage) {
    throw metadataError(
      "invalid_request",
      "FactGrid document links are managed by the transcription workflow.",
      400,
    );
  }
  const definition = snapshot.properties[snak.property as PropertyId];
  if (!definition) {
    throw metadataError("invalid_request", `No current FactGrid definition was loaded for ${snak.property}.`, 400);
  }
  const kind = expectedValueKind(definition.datatype);
  if (!kind) {
    throw metadataError(
      "unsupported_edition",
      `${snak.property} uses unsupported datatype ${definition.datatype} and is read-only here.`,
      422,
    );
  }
  if (snak.datatype !== definition.datatype) {
    throw metadataError("invalid_request", `${snak.property} no longer has the submitted datatype.`, 409);
  }
  if (snak.snaktype !== "value") return;
  if (snak.value.kind !== kind) {
    throw metadataError("invalid_request", `${snak.property} has a value of the wrong datatype.`, 400);
  }
  if (snak.value.kind === "entity") {
    const entityType = expectedEntityType(definition.datatype);
    if (snak.value.entityType !== entityType) {
      throw metadataError("invalid_request", `${snak.property} has the wrong entity reference type.`, 400);
    }
    const prefixes: Record<string, RegExp> = {
      item: /^Q[1-9][0-9]{0,14}$/u,
      property: /^P[1-9][0-9]{0,14}$/u,
      lexeme: /^L[1-9][0-9]{0,14}$/u,
      form: /^L[1-9][0-9]{0,14}-F[1-9][0-9]{0,14}$/u,
      sense: /^L[1-9][0-9]{0,14}-S[1-9][0-9]{0,14}$/u,
    };
    if (!prefixes[snak.value.entityType]?.test(snak.value.id)) {
      throw metadataError("invalid_request", `${snak.property} has an invalid entity reference.`, 400);
    }
  }
  if (snak.value.kind === "string" && definition.datatype === "url") {
    assertSafeContentUrl(snak.value.value, snak.property);
  }
  if (snak.value.kind === "time") assertSafeContentUrl(snak.value.calendarModel, "Calendar model");
  if (snak.value.kind === "quantity" && snak.value.unit !== "1") {
    assertSafeContentUrl(snak.value.unit, "Quantity unit");
  }
  if (snak.value.kind === "coordinate") assertSafeContentUrl(snak.value.globe, "Coordinate globe");
}

function orderedKeysMatch(record: Record<string, unknown>, order: readonly string[]): boolean {
  const keys = Object.keys(record);
  return keys.length === order.length && new Set(order).size === order.length && keys.every((key) => order.includes(key));
}

function statementById(entity: WikibaseEntity, id: string): WikibaseStatement | undefined {
  for (const statements of Object.values(entity.claims ?? {})) {
    const found = statements.find((statement) => statement.id === id);
    if (found) return found;
  }
  return undefined;
}

function statementIdBelongsToEntity(id: string, qid: Qid): boolean {
  const separator = id.indexOf("$");
  return (
    separator > 0 &&
    separator < id.length - 1 &&
    id.slice(0, separator).toUpperCase() === qid
  );
}

function wikibaseStatementContainsProperty(
  statement: WikibaseStatement,
  property: string,
): boolean {
  if (statement.mainsnak?.property === property) return true;
  if (
    Object.values(statement.qualifiers ?? {}).some((snaks) =>
      snaks.some((snak) => snak.property === property)
    )
  ) {
    return true;
  }
  return (statement.references ?? []).some((reference) =>
    Object.values(reference.snaks ?? {}).some((snaks) =>
      snaks.some((snak) => snak.property === property)
    )
  );
}

function statementRemovesData(current: WikibaseStatement, next: MetadataStatement): boolean {
  const currentQualifierCount = Object.values(current.qualifiers ?? {}).reduce((sum, values) => sum + values.length, 0);
  const nextQualifierCount = Object.values(next.qualifiers).reduce((sum, values) => sum + values.length, 0);
  const currentReferenceCount = current.references?.length ?? 0;
  const nextQualifierHashes = new Set(
    Object.values(next.qualifiers).flatMap((snaks) =>
      snaks.flatMap((snak) => (snak.hash ? [snak.hash] : [])),
    ),
  );
  const removedQualifierHash = Object.values(current.qualifiers ?? {}).some((snaks) =>
    snaks.some((snak) => Boolean(snak.hash && !nextQualifierHashes.has(snak.hash))),
  );
  const nextReferenceHashes = new Set(
    next.references.flatMap((reference) => (reference.hash ? [reference.hash] : [])),
  );
  const removedReferenceHash = (current.references ?? []).some((reference) =>
    Boolean(reference.hash && !nextReferenceHashes.has(reference.hash)),
  );
  return (
    (current.mainsnak?.snaktype === "value" && next.mainsnak.snaktype !== "value") ||
    nextQualifierCount < currentQualifierCount ||
    next.references.length < currentReferenceCount ||
    removedQualifierHash ||
    removedReferenceHash
  );
}

function statementRemovesCatalogueMembership(current: WikibaseStatement, next?: MetadataStatement): boolean {
  const value = current.mainsnak?.datavalue?.value;
  const isMembership =
    current.mainsnak?.property === FACTGRID_PROPERTIES.membership &&
    current.mainsnak.snaktype === "value" &&
    value &&
    typeof value === "object" &&
    "id" in value &&
    value.id === "Q512006";
  if (!isMembership || current.rank === "deprecated") return false;
  return !next ||
    next.rank === "deprecated" ||
    next.mainsnak.snaktype !== "value" ||
    next.mainsnak.value.kind !== "entity" ||
    next.mainsnak.value.id !== "Q512006";
}

function toDataValue(value: MetadataValue): { type: string; value: unknown } {
  switch (value.kind) {
    case "string":
      return { type: "string", value: value.value };
    case "entity": {
      const numericId = Number(value.id.match(/^[A-Z]+([0-9]+)/u)?.[1]);
      return {
        type: "wikibase-entityid",
        value: {
          "entity-type": value.entityType,
          "numeric-id": numericId,
          id: value.id,
        },
      };
    }
    case "monolingualtext":
      return { type: "monolingualtext", value: { text: value.text, language: value.language } };
    case "time":
      return {
        type: "time",
        value: {
          time: value.time,
          timezone: value.timezone,
          before: value.before,
          after: value.after,
          precision: value.precision,
          calendarmodel: value.calendarModel,
        },
      };
    case "quantity":
      return {
        type: "quantity",
        value: {
          amount: value.amount,
          unit: value.unit,
          ...(value.lowerBound ? { lowerBound: value.lowerBound } : {}),
          ...(value.upperBound ? { upperBound: value.upperBound } : {}),
        },
      };
    case "coordinate":
      return {
        type: "globecoordinate",
        value: {
          latitude: value.latitude,
          longitude: value.longitude,
          altitude: value.altitude,
          precision: value.precision,
          globe: value.globe,
        },
      };
  }
}

function toWikibaseSnak(snak: MetadataSnak): Record<string, unknown> {
  return {
    snaktype: snak.snaktype,
    property: snak.property,
    datatype: snak.datatype,
    ...(snak.hash ? { hash: snak.hash } : {}),
    ...(snak.snaktype === "value" ? { datavalue: toDataValue(snak.value) } : {}),
  };
}

function toSnakMap(map: Record<string, MetadataSnak[]>): Record<string, unknown[]> {
  return Object.fromEntries(
    Object.entries(map).map(([property, snaks]) => [property, snaks.map(toWikibaseSnak)]),
  );
}

function toWikibaseStatement(statement: MetadataStatement): Record<string, unknown> {
  return {
    type: "statement",
    ...(statement.id ? { id: statement.id } : {}),
    rank: statement.rank,
    mainsnak: toWikibaseSnak(statement.mainsnak),
    qualifiers: toSnakMap(statement.qualifiers),
    "qualifiers-order": statement.qualifierOrder,
    references: statement.references.map((reference) => ({
      ...(reference.hash ? { hash: reference.hash } : {}),
      snaks: toSnakMap(reference.snaks),
      "snaks-order": reference.snaksOrder,
    })),
  };
}

function validateOperations(
  qid: Qid,
  request: MetadataWriteRequest,
  snapshot: EditableTabletEntity,
): void {
  const operationKeys = new Set<string>();
  const claimIds = new Set<string>();
  const newStatements: MetadataStatement[] = [];
  for (const operation of request.operations) {
    let key: string;
    if (operation.type === "set-label" || operation.type === "set-description") {
      key = `${operation.type}:${operation.language}`;
    } else if (operation.type === "set-aliases") {
      key = `${operation.type}:${operation.language}`;
    } else if (operation.type === "set-sitelink") {
      key = `${operation.type}:${operation.site}`;
    } else if (operation.type === "remove-statement") {
      key = `statement:${operation.statementId}`;
    } else if (operation.type === "upsert-statement") {
      key = operation.statement.id
        ? `statement:${operation.statement.id}`
        : `new-statement:${operation.statement.mainsnak.property}:${operationKeys.size}`;
    } else {
      throw metadataError("invalid_request", "Unsupported metadata operation.", 400);
    }
    if (operationKeys.has(key)) {
      throw metadataError("invalid_request", "The same metadata target was changed more than once.", 400);
    }
    operationKeys.add(key);

    if (operation.type === "remove-statement") {
      if (!statementIdBelongsToEntity(operation.statementId, qid)) {
        throw metadataError("invalid_request", "The statement does not belong to this tablet.", 400);
      }
      const current = statementById(snapshot.entity, operation.statementId);
      if (!current) throw metadataError("edit_conflict", "The statement no longer exists on this tablet.", 409);
      if (wikibaseStatementContainsProperty(current, FACTGRID_PROPERTIES.documentPage)) {
        throw metadataError("invalid_request", "FactGrid document links are managed by the transcription workflow.", 400);
      }
      if (!request.confirmCatalogueRemoval && statementRemovesCatalogueMembership(current)) {
        throw metadataError("invalid_request", "Removing catalogue membership requires explicit confirmation.", 400);
      }
      continue;
    }
    if (operation.type !== "upsert-statement") continue;

    const statement = operation.statement;
    if (statement.mainsnak.property === FACTGRID_PROPERTIES.documentPage) {
      throw metadataError("invalid_request", "FactGrid document links are managed by the transcription workflow.", 400);
    }
    assertSnak(statement.mainsnak, snapshot);
    if (!orderedKeysMatch(statement.qualifiers, statement.qualifierOrder)) {
      throw metadataError("invalid_request", "Qualifier order must contain every qualifier property exactly once.", 400);
    }
    for (const [property, snaks] of Object.entries(statement.qualifiers)) {
      for (const snak of snaks) assertSnak(snak, snapshot, property);
    }
    for (const reference of statement.references) {
      if (!orderedKeysMatch(reference.snaks, reference.snaksOrder)) {
        throw metadataError("invalid_request", "Reference order must contain every reference property exactly once.", 400);
      }
      for (const [property, snaks] of Object.entries(reference.snaks)) {
        for (const snak of snaks) assertSnak(snak, snapshot, property);
      }
    }
    if (!statement.id) {
      const hasExistingHash = Boolean(
        statement.mainsnak.hash ||
          Object.values(statement.qualifiers).some((snaks) => snaks.some((snak) => snak.hash)) ||
          statement.references.some(
            (reference) =>
              reference.hash ||
              Object.values(reference.snaks).some((snaks) => snaks.some((snak) => snak.hash)),
          ),
      );
      if (hasExistingHash) {
        throw metadataError("invalid_request", "New statements cannot reuse existing hashes.", 400);
      }
      if (
        newStatements.some((current) =>
          sameJson(requestStatementSubstance(current), requestStatementSubstance(statement))
        )
      ) {
        throw metadataError(
          "invalid_request",
          "The same new metadata statement was added more than once.",
          400,
        );
      }
      const currentStatements = snapshot.entity.claims?.[statement.mainsnak.property] ?? [];
      if (
        currentStatements.some((current) =>
          sameJson(normalizeStatementSubstance(current), requestStatementSubstance(statement))
        )
      ) {
        throw metadataError(
          "invalid_request",
          "This metadata statement already exists on the tablet.",
          400,
        );
      }
      newStatements.push(statement);
      continue;
    }
    if (!statementIdBelongsToEntity(statement.id, qid) || claimIds.has(statement.id)) {
      throw metadataError("invalid_request", "The statement identifier is invalid or duplicated.", 400);
    }
    claimIds.add(statement.id);
    const current = statementById(snapshot.entity, statement.id);
    if (!current) throw metadataError("edit_conflict", "The statement no longer exists on this tablet.", 409);
    if (wikibaseStatementContainsProperty(current, FACTGRID_PROPERTIES.documentPage)) {
      throw metadataError("invalid_request", "FactGrid document links are managed by the transcription workflow.", 400);
    }
    if (current.mainsnak?.property !== statement.mainsnak.property) {
      throw metadataError("invalid_request", "An existing statement cannot be moved to another property.", 400);
    }
    if (statement.mainsnak.hash !== undefined && statement.mainsnak.hash !== current.mainsnak?.hash) {
      throw metadataError("invalid_request", "The mainsnak hash does not belong to this statement value.", 400);
    }

    const consumeHashes = (
      submitted: readonly MetadataSnak[],
      available: readonly WikibaseSnak[],
      message: string,
    ): void => {
      const counts = new Map<string, number>();
      for (const snak of available) {
        if (snak.hash) counts.set(snak.hash, (counts.get(snak.hash) ?? 0) + 1);
      }
      for (const snak of submitted) {
        if (!snak.hash) continue;
        const remaining = counts.get(snak.hash) ?? 0;
        if (remaining <= 0) throw metadataError("invalid_request", message, 400);
        counts.set(snak.hash, remaining - 1);
      }
    };

    for (const [property, snaks] of Object.entries(statement.qualifiers)) {
      consumeHashes(
        snaks,
        current.qualifiers?.[property] ?? [],
        "A qualifier hash does not belong to this statement property.",
      );
    }

    const currentReferencesByHash = new Map<string, WikibaseReference[]>();
    for (const reference of current.references ?? []) {
      if (!reference.hash) continue;
      const matches = currentReferencesByHash.get(reference.hash) ?? [];
      matches.push(reference);
      currentReferencesByHash.set(reference.hash, matches);
    }
    for (const reference of statement.references) {
      const submittedNestedHashes = Object.values(reference.snaks).some((snaks) =>
        snaks.some((snak) => Boolean(snak.hash))
      );
      if (!reference.hash) {
        if (submittedNestedHashes) {
          throw metadataError("invalid_request", "A new reference cannot reuse existing snak hashes.", 400);
        }
        continue;
      }
      const candidates = currentReferencesByHash.get(reference.hash);
      const currentReference = candidates?.shift();
      if (!currentReference) {
        throw metadataError("invalid_request", "A reference hash does not belong to this statement.", 400);
      }
      for (const [property, snaks] of Object.entries(reference.snaks)) {
        consumeHashes(
          snaks,
          currentReference.snaks?.[property] ?? [],
          "A reference snak hash does not belong to this reference property.",
        );
      }
    }
    if (!request.confirmRemovals && statementRemovesData(current, statement)) {
      throw metadataError("invalid_request", "Removing qualifiers or references requires confirmation.", 400);
    }
    if (!request.confirmCatalogueRemoval && statementRemovesCatalogueMembership(current, statement)) {
      throw metadataError("invalid_request", "Changing catalogue membership requires explicit confirmation.", 400);
    }
  }
}

function buildPatch(operations: readonly MetadataOperation[]): Record<string, unknown> {
  const labels: Record<string, unknown> = {};
  const descriptions: Record<string, unknown> = {};
  const aliases: Record<string, unknown> = {};
  const sitelinks: Record<string, unknown> = {};
  const claims: unknown[] = [];
  for (const operation of operations) {
    switch (operation.type) {
      case "set-label":
        labels[operation.language] = operation.value === null
          ? { language: operation.language, remove: "" }
          : { language: operation.language, value: operation.value };
        break;
      case "set-description":
        descriptions[operation.language] = operation.value === null
          ? { language: operation.language, remove: "" }
          : { language: operation.language, value: operation.value };
        break;
      case "set-aliases":
        aliases[operation.language] = operation.values.map((value) => ({
          language: operation.language,
          value,
        }));
        break;
      case "set-sitelink":
        sitelinks[operation.site] = operation.title === null
          ? { site: operation.site, remove: "" }
          : { site: operation.site, title: operation.title, badges: operation.badges ?? [] };
        break;
      case "remove-statement":
        claims.push({ id: operation.statementId, remove: "" });
        break;
      case "upsert-statement":
        claims.push(toWikibaseStatement(operation.statement));
        break;
    }
  }
  return {
    ...(Object.keys(labels).length ? { labels } : {}),
    ...(Object.keys(descriptions).length ? { descriptions } : {}),
    ...(Object.keys(aliases).length ? { aliases } : {}),
    ...(Object.keys(sitelinks).length ? { sitelinks } : {}),
    ...(claims.length ? { claims } : {}),
  };
}

function canonicalValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && typeof record["entity-type"] === "string") {
    return { kind: "entity", id: record.id, entityType: record["entity-type"] };
  }
  if (typeof record.text === "string" && typeof record.language === "string") {
    return { kind: "monolingualtext", text: record.text, language: record.language };
  }
  if (typeof record.time === "string") {
    return {
      kind: "time",
      time: record.time,
      timezone: record.timezone,
      before: record.before,
      after: record.after,
      precision: record.precision,
      calendarModel: record.calendarmodel,
    };
  }
  if (typeof record.amount === "string") {
    return {
      kind: "quantity",
      amount: record.amount,
      unit: record.unit,
      ...(record.lowerBound ? { lowerBound: record.lowerBound } : {}),
      ...(record.upperBound ? { upperBound: record.upperBound } : {}),
    };
  }
  if (typeof record.latitude === "number" && typeof record.longitude === "number") {
    return {
      kind: "coordinate",
      latitude: record.latitude,
      longitude: record.longitude,
      altitude: record.altitude ?? null,
      precision: record.precision,
      globe: record.globe,
    };
  }
  return value;
}

function normalizeSnak(snak: WikibaseSnak | undefined): unknown {
  if (!snak) return null;
  return {
    property: snak.property,
    datatype: snak.datatype,
    snaktype: snak.snaktype,
    ...(snak.snaktype === "value"
      ? {
          value:
            typeof snak.datavalue?.value === "string"
              ? { kind: "string", value: snak.datavalue.value }
              : canonicalValue(snak.datavalue?.value),
        }
      : {}),
  };
}

function normalizeStatement(statement: WikibaseStatement): unknown {
  const qualifiers = Object.fromEntries(
    Object.entries(statement.qualifiers ?? {}).map(([property, snaks]) => [
      property,
      snaks.map(normalizeSnak),
    ]),
  );
  return {
    rank: statement.rank,
    mainsnak: normalizeSnak(statement.mainsnak),
    qualifiers,
    qualifierOrder: statement["qualifiers-order"] ?? Object.keys(qualifiers),
    references: (statement.references ?? []).map((reference) => {
      const snaks = Object.fromEntries(
        Object.entries(reference.snaks ?? {}).map(([property, values]) => [
          property,
          values.map(normalizeSnak),
        ]),
      );
      return {
        snaks,
        snaksOrder: reference["snaks-order"] ?? Object.keys(snaks),
      };
    }),
  };
}

function requestStatementComparable(statement: MetadataStatement): unknown {
  return {
    rank: statement.rank,
    mainsnak: statement.mainsnak,
    qualifiers: statement.qualifiers,
    qualifierOrder: statement.qualifierOrder,
    references: statement.references.map(({ snaks, snaksOrder }) => ({ snaks, snaksOrder })),
  };
}

function normalizeStatementSubstance(statement: WikibaseStatement): unknown {
  const comparable = normalizeStatement(statement) as {
    rank: unknown;
    mainsnak: unknown;
    qualifiers: unknown;
    references: Array<{ snaks: unknown }>;
  };
  return {
    rank: comparable.rank,
    mainsnak: comparable.mainsnak,
    qualifiers: comparable.qualifiers,
    references: comparable.references.map(({ snaks }) => ({ snaks })),
  };
}

function requestStatementSubstance(statement: MetadataStatement): unknown {
  return {
    rank: statement.rank,
    mainsnak: statement.mainsnak,
    qualifiers: statement.qualifiers,
    references: statement.references.map(({ snaks }) => ({ snaks })),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function verifyReadback(
  before: EditableTabletEntity["entity"],
  after: EditableTabletEntity["entity"],
  request: MetadataWriteRequest,
  expectedRevision: number,
): void {
  if (after.lastrevid !== expectedRevision) {
    throw metadataError(
      "save_confirmation_failed",
      "FactGrid accepted the edit, but a newer tablet revision is already current.",
      409,
    );
  }
  const touchedLabels = new Set<string>();
  const touchedDescriptions = new Set<string>();
  const touchedAliases = new Set<string>();
  const touchedSitelinks = new Set<string>();
  const touchedStatementIds = new Set<string>();
  for (const operation of request.operations) {
    if (operation.type === "set-label") {
      touchedLabels.add(operation.language);
      const actual = after.labels?.[operation.language]?.value;
      if (operation.value === null ? actual !== undefined : actual !== operation.value) {
        throw metadataError("save_confirmation_failed", "The saved label could not be confirmed.", 409);
      }
    } else if (operation.type === "set-description") {
      touchedDescriptions.add(operation.language);
      const actual = after.descriptions?.[operation.language]?.value;
      if (operation.value === null ? actual !== undefined : actual !== operation.value) {
        throw metadataError("save_confirmation_failed", "The saved description could not be confirmed.", 409);
      }
    } else if (operation.type === "set-aliases") {
      touchedAliases.add(operation.language);
      const actual = (after.aliases?.[operation.language] ?? []).map((term) => term.value);
      if (!sameJson(actual, operation.values)) {
        throw metadataError("save_confirmation_failed", "The saved aliases could not be confirmed.", 409);
      }
    } else if (operation.type === "set-sitelink") {
      touchedSitelinks.add(operation.site);
      const actual = after.sitelinks?.[operation.site];
      if (
        operation.title === null
          ? actual !== undefined
          : actual?.title !== operation.title || !sameJson(actual.badges ?? [], operation.badges ?? [])
      ) {
        throw metadataError("save_confirmation_failed", "The saved sitelink could not be confirmed.", 409);
      }
    } else if (operation.type === "remove-statement") {
      touchedStatementIds.add(operation.statementId);
      if (statementById(after, operation.statementId)) {
        throw metadataError("save_confirmation_failed", "The statement removal could not be confirmed.", 409);
      }
    } else if (operation.type === "upsert-statement" && operation.statement.id) {
      touchedStatementIds.add(operation.statement.id);
      const actual = statementById(after, operation.statement.id);
      if (!actual || !sameJson(normalizeStatement(actual), requestStatementComparable(operation.statement))) {
        throw metadataError("save_confirmation_failed", "The saved statement could not be confirmed.", 409);
      }
    } else if (operation.type === "upsert-statement") {
      const propertyStatements = after.claims?.[operation.statement.mainsnak.property] ?? [];
      const beforeIds = new Set(
        (before.claims?.[operation.statement.mainsnak.property] ?? []).map((statement) => statement.id),
      );
      const matches = propertyStatements.filter(
        (statement) =>
          !beforeIds.has(statement.id) &&
          sameJson(normalizeStatement(statement), requestStatementComparable(operation.statement)),
      );
      if (matches.length !== 1) {
        throw metadataError("save_confirmation_failed", "The added statement could not be confirmed uniquely.", 409);
      }
    } else {
      throw metadataError("save_confirmation_failed", "The metadata operation could not be confirmed.", 409);
    }
  }

  for (const [language, value] of Object.entries(before.labels ?? {})) {
    if (!touchedLabels.has(language) && !sameJson(after.labels?.[language], value)) {
      throw metadataError("save_confirmation_failed", "An untouched label changed during the save.", 409);
    }
  }
  for (const [language, value] of Object.entries(before.descriptions ?? {})) {
    if (!touchedDescriptions.has(language) && !sameJson(after.descriptions?.[language], value)) {
      throw metadataError("save_confirmation_failed", "An untouched description changed during the save.", 409);
    }
  }
  for (const [language, value] of Object.entries(before.aliases ?? {})) {
    if (!touchedAliases.has(language) && !sameJson(after.aliases?.[language], value)) {
      throw metadataError("save_confirmation_failed", "Untouched aliases changed during the save.", 409);
    }
  }
  for (const [site, value] of Object.entries(before.sitelinks ?? {})) {
    if (!touchedSitelinks.has(site) && !sameJson(after.sitelinks?.[site], value)) {
      throw metadataError("save_confirmation_failed", "An untouched sitelink changed during the save.", 409);
    }
  }
  for (const statements of Object.values(before.claims ?? {})) {
    for (const statement of statements) {
      if (!statement.id || touchedStatementIds.has(statement.id)) continue;
      if (!sameJson(statementById(after, statement.id), statement)) {
        throw metadataError("save_confirmation_failed", "An untouched statement changed during the save.", 409);
      }
    }
  }
}

export interface SaveMetadataInput {
  qid: Qid;
  accessToken: string;
  identity: VerifiedEditorIdentity;
  request: MetadataWriteRequest;
}

export interface SaveMetadataDependencies {
  factGrid?: Pick<ReturnType<typeof createFactGridClient>, "getEditableTabletEntity">;
  mutationClient?: MetadataMutationClient;
}

export interface SavedMetadata {
  revisionId: number;
  snapshot: EditableTabletEntity;
}

export async function saveMetadata(
  input: SaveMetadataInput,
  dependencies: SaveMetadataDependencies = {},
): Promise<SavedMetadata> {
  const factGrid = dependencies.factGrid ?? createFactGridClient({ revalidateSeconds: false });
  const mutationClient = dependencies.mutationClient ?? createMetadataMutationClient();
  const extraProperties = propertyIdsForOperations(input.request.operations);
  const before = await factGrid.getEditableTabletEntity(input.qid, extraProperties);
  if (before.entity.lastrevid !== input.request.baseRevision) {
    throw metadataError(
      "edit_conflict",
      "FactGrid has a newer tablet revision than the one opened in the editor.",
      409,
    );
  }
  validateOperations(input.qid, input.request, before);
  const patch = buildPatch(input.request.operations);
  const inspection = await mutationClient.inspect(input.accessToken, input.qid, input.identity);
  const revisionId = await mutationClient.submit(
    input.accessToken,
    input.qid,
    input.request.baseRevision,
    input.request.summary,
    patch,
    inspection,
  );

  let after: EditableTabletEntity;
  try {
    after = await factGrid.getEditableTabletEntity(input.qid, extraProperties, false);
    verifyReadback(before.entity, after.entity, input.request, revisionId);
    await mutationClient.confirmAttribution(
      input.accessToken,
      input.qid,
      revisionId,
      input.request.summary,
      inspection,
    );
  } catch (cause) {
    if (isTranscriptEditError(cause) && cause.code === "save_confirmation_failed") throw cause;
    throw metadataError(
      "save_confirmation_failed",
      "FactGrid accepted the metadata edit, but the saved entity could not be read back.",
      isTranscriptEditError(cause) && cause.status === 409 ? 409 : 502,
      cause,
    );
  }
  return { revisionId, snapshot: after };
}
