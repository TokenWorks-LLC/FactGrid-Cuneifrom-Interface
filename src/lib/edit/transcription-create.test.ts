import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildTranscriptionSource,
  createTranscription,
  createTranscriptionCreationProvider,
  parseTranscriptionCreateRequest,
  TranscriptionCreationError,
  transcriptionUrl,
  type TranscriptionCreationInspection,
  type TranscriptionCreationProvider,
} from "./transcription-create";
import { parseAllowedEditTargets } from "./targets";

const identity = { providerUserId: "17", username: "Editor" };
const request = { text: "1. šarrum\n2. É.GAL", summary: "Add a new reading" };
const qid = "Q42" as const;
const canonicalUrl = transcriptionUrl(qid);
const canonicalSource = buildTranscriptionSource(qid, request.text);

function creationInput() {
  return {
    qid,
    accessToken: "token",
    identity,
    request,
    contributorPolicy: "authenticated" as const,
    allowedTargets: new Set<string>(),
  };
}

function inspection(
  overrides: Partial<TranscriptionCreationInspection> = {},
): TranscriptionCreationInspection {
  return {
    qid,
    entityRevisionId: 50,
    isCatalogueMember: true,
    p251Values: [],
    p69Values: [],
    entityEditable: true,
    page: {
      exists: false,
      title: "D-Q42",
      namespace: 0,
      editable: true,
    },
    csrfToken: "csrf-token-value",
    requestStartedAt: "2026-09-29T10:00:00Z",
    ...overrides,
  };
}

function confirmedPage(
  overrides: Partial<TranscriptionCreationInspection> = {},
): TranscriptionCreationInspection {
  return inspection({
    entityRevisionId: 50,
    page: {
      exists: true,
      title: "D-Q42",
      namespace: 0,
      editable: true,
      pageId: 9,
      revisionId: 101,
      source: canonicalSource,
      contentModel: "wikitext",
      contentFormat: "text/x-wiki",
      username: identity.username,
      userId: identity.providerUserId,
      comment: request.summary,
    },
    ...overrides,
  });
}

function confirmedLink(): TranscriptionCreationInspection {
  return confirmedPage({ entityRevisionId: 51, p251Values: [canonicalUrl] });
}

function providerWithInspections(
  ...inspections: TranscriptionCreationInspection[]
): TranscriptionCreationProvider & {
  inspect: ReturnType<typeof vi.fn>;
  createPage: ReturnType<typeof vi.fn>;
  linkPage: ReturnType<typeof vi.fn>;
} {
  return {
    inspect: vi.fn().mockImplementation(() => {
      const next = inspections.shift();
      if (!next) throw new Error("unexpected inspection");
      return Promise.resolve(next);
    }),
    createPage: vi.fn().mockResolvedValue({ revisionId: 101 }),
    linkPage: vi.fn().mockResolvedValue({ revisionId: 51 }),
  };
}

describe("transcription creation orchestration", () => {
  it("enforces the restricted deployment policy against only the derived target", async () => {
    const provider = providerWithInspections(inspection(), confirmedPage(), confirmedLink());
    const restricted = {
      ...creationInput(),
      contributorPolicy: "restricted" as const,
      allowedTargets: parseAllowedEditTargets("Q42|D-Q42"),
    };

    await expect(
      createTranscription(
        { ...restricted, allowedTargets: parseAllowedEditTargets("Q42|D-Q999") },
        { provider },
      ),
    ).rejects.toMatchObject({ code: "target_not_allowed" });
    expect(provider.inspect).not.toHaveBeenCalled();

    const result = await createTranscription(restricted, { provider });
    expect(result.status).toBe("created_and_linked");
  });

  it("creates and links an exact server-derived D page from the no-local state", async () => {
    const provider = providerWithInspections(inspection(), confirmedPage(), confirmedLink());

    const result = await createTranscription(
      creationInput(),
      { provider },
    );

    expect(result).toMatchObject({
      status: "created_and_linked",
      initialState: "no_local",
      title: "D-Q42",
      url: canonicalUrl,
      pageRevisionId: 101,
      entityRevisionId: 51,
      text: request.text,
    });
    expect(provider.createPage).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "D-Q42",
        source: canonicalSource,
        summary: request.summary,
      }),
    );
    expect(provider.linkPage).toHaveBeenCalledWith(
      expect.objectContaining({ url: canonicalUrl }),
    );
  });

  it("preserves an external-only P69 provenance link while adding the local page", async () => {
    const provider = providerWithInspections(
      inspection({ p69Values: ["https://example.test/external"] }),
      confirmedPage({ p69Values: ["https://example.test/external"] }),
      confirmedLink(),
    );

    const result = await createTranscription(
      creationInput(),
      { provider },
    );

    expect(result.initialState).toBe("external_only");
    expect(provider.createPage).toHaveBeenCalledOnce();
    expect(provider.linkPage).toHaveBeenCalledOnce();
  });

  it("creates a currently linked but missing canonical page without adding P251 again", async () => {
    const provider = providerWithInspections(
      inspection({ p251Values: [canonicalUrl], entityEditable: false }),
      confirmedPage({ p251Values: [canonicalUrl], entityEditable: false }),
    );

    const result = await createTranscription(
      creationInput(),
      { provider },
    );

    expect(result).toMatchObject({ status: "created", initialState: "linked_missing" });
    expect(provider.createPage).toHaveBeenCalledOnce();
    expect(provider.linkPage).not.toHaveBeenCalled();
  });

  it("treats a linked existing page as an idempotent success", async () => {
    const provider = providerWithInspections(
      confirmedPage({ p251Values: [canonicalUrl], entityEditable: false }),
    );

    const result = await createTranscription(
      creationInput(),
      { provider },
    );

    expect(result.status).toBe("already_available");
    expect(result.initialState).toBe("existing");
    expect(provider.createPage).not.toHaveBeenCalled();
    expect(provider.linkPage).not.toHaveBeenCalled();
  });

  it("preserves a stale draft when the linked page has different content", async () => {
    const current = confirmedPage({ p251Values: [canonicalUrl], entityEditable: false });
    current.page = { ...current.page, source: buildTranscriptionSource(qid, "1. a different reading") };
    const provider = providerWithInspections(current);

    await expect(
      createTranscription(creationInput(), { provider }),
    ).rejects.toMatchObject({
      code: "existing_local_transcription",
      status: 409,
      state: "existing",
    });
    expect(provider.createPage).not.toHaveBeenCalled();
    expect(provider.linkPage).not.toHaveBeenCalled();
  });

  it("does not overwrite or silently supplement another current P251 document", async () => {
    const provider = providerWithInspections(
      inspection({ p251Values: ["https://database.factgrid.de/wiki/CoNLL-U-Q42"] }),
    );

    await expect(
      createTranscription(creationInput(), { provider }),
    ).rejects.toMatchObject({ code: "existing_local_transcription", state: "existing" });
    expect(provider.createPage).not.toHaveBeenCalled();
  });

  it("does not create a page when the entity cannot be linked", async () => {
    const provider = providerWithInspections(inspection({ entityEditable: false }));

    await expect(
      createTranscription(creationInput(), { provider }),
    ).rejects.toMatchObject({ code: "entity_not_editable" });
    expect(provider.createPage).not.toHaveBeenCalled();
    expect(provider.linkPage).not.toHaveBeenCalled();
  });

  it("reconciles a concurrent create-only collision only when the exact attributed page matches", async () => {
    const provider = providerWithInspections(inspection(), confirmedPage(), confirmedLink());
    provider.createPage.mockRejectedValue(
      new TranscriptionCreationError(
        "page_exists_unlinked",
        "created concurrently",
        { status: 409 },
      ),
    );

    const result = await createTranscription(
      creationInput(),
      { provider },
    );

    expect(result.status).toBe("created_and_linked");
    expect(provider.createPage).toHaveBeenCalledOnce();
    expect(provider.linkPage).toHaveBeenCalledOnce();
  });

  it("does not blindly retry an uncertain page creation", async () => {
    const provider = providerWithInspections(inspection());
    provider.createPage.mockRejectedValue(
      new TranscriptionCreationError(
        "creation_status_unknown",
        "connection ended",
        { status: 502 },
      ),
    );

    await expect(
      createTranscription(creationInput(), { provider }),
    ).rejects.toMatchObject({
      code: "creation_status_unknown",
      recovery: { title: "D-Q42", nextAction: "check_page" },
    });
    expect(provider.createPage).toHaveBeenCalledOnce();
    expect(provider.inspect).toHaveBeenCalledOnce();
    expect(provider.linkPage).not.toHaveBeenCalled();
  });

  it("reports confirmed page creation as partial when linking is rejected", async () => {
    const provider = providerWithInspections(inspection(), confirmedPage());
    provider.linkPage.mockRejectedValue(
      new TranscriptionCreationError(
        "provider_rejected_link",
        "entity changed",
        { status: 409 },
      ),
    );

    await expect(
      createTranscription(creationInput(), { provider }),
    ).rejects.toMatchObject({
      code: "provider_rejected_link",
      recovery: { pageRevisionId: 101, nextAction: "link_page" },
    });
    expect(provider.createPage).toHaveBeenCalledOnce();
    expect(provider.linkPage).toHaveBeenCalledOnce();
  });

  it("reconciles an uncertain link response by read-only inspection without retrying", async () => {
    const provider = providerWithInspections(inspection(), confirmedPage(), confirmedLink());
    provider.linkPage.mockRejectedValue(
      new TranscriptionCreationError("link_status_unknown", "connection ended", {
        status: 502,
      }),
    );

    const result = await createTranscription(
      creationInput(),
      { provider },
    );

    expect(result.status).toBe("created_and_linked");
    expect(provider.linkPage).toHaveBeenCalledOnce();
  });

  it("retains check-link recovery when an uncertain link cannot be confirmed", async () => {
    const provider = providerWithInspections(inspection(), confirmedPage(), confirmedPage());
    provider.linkPage.mockRejectedValue(
      new TranscriptionCreationError("link_status_unknown", "connection ended", {
        status: 502,
      }),
    );

    await expect(
      createTranscription(creationInput(), { provider }),
    ).rejects.toMatchObject({
      code: "link_status_unknown",
      recovery: { pageRevisionId: 101, nextAction: "check_link" },
    });
    expect(provider.linkPage).toHaveBeenCalledOnce();
  });
});

describe("transcription creation request", () => {
  it("accepts the bounded browser recovery fields without accepting write destinations", async () => {
    const parsed = await parseTranscriptionCreateRequest(
      new Request("https://app.example/api/tablets/Q42/transcription", {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=utf-8" },
        body: JSON.stringify({
          text: "1. šarrum",
          summary: "Add reading",
          baseRevision: 50,
        }),
      }),
    );

    expect(parsed).toEqual({
      text: "1. šarrum",
      summary: "Add reading",
      baseRevision: 50,
    });
  });

  it("rejects a browser-supplied title or action", async () => {
    const requestWithTarget = new Request("https://app.example/api/tablets/Q42/transcription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "1. reading",
        summary: "",
        title: "User:Attacker/page",
        action: "delete",
      }),
    });

    await expect(parseTranscriptionCreateRequest(requestWithTarget)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});

describe("FactGrid transcription creation provider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses createonly for page creation and baserevid for one P251 addition", async () => {
    const forms: URLSearchParams[] = [];
    const authorizationHeader = vi.fn(() => "OAuth signed");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const form = init?.body as URLSearchParams;
      forms.push(form);
      if (form.get("action") === "edit") {
        return Response.json({
          edit: { result: "Success", title: "D-Q42", newrevid: 101 },
        });
      }
      return Response.json({ entity: { id: "Q42", lastrevid: 51 } });
    });
    const provider = createTranscriptionCreationProvider({
      fetch: fetchMock,
      authorizationHeader,
    });
    const base = inspection();

    await provider.createPage({
      accessToken: "token",
      inspection: base,
      identity,
      title: "D-Q42",
      source: canonicalSource,
      summary: request.summary,
    });
    await provider.linkPage({
      accessToken: "token",
      inspection: base,
      identity,
      url: canonicalUrl,
      summary: "Link document",
    });

    expect(forms[0].get("createonly")).toBe("1");
    expect(forms[0].get("nocreate")).toBeNull();
    expect(forms[0].get("text")).toBe(canonicalSource);
    expect(authorizationHeader).toHaveBeenCalledWith(
      "token",
      "POST",
      expect.any(URL),
      forms[0],
    );
    expect(forms[1].get("baserevid")).toBe("50");
    expect(JSON.parse(forms[1].get("data") as string)).toEqual({
      claims: [
        expect.objectContaining({
          rank: "normal",
          mainsnak: expect.objectContaining({
            property: "P251",
            datatype: "url",
            datavalue: { type: "string", value: canonicalUrl },
          }),
        }),
      ],
    });
  });

  it("loads current membership, P251/P69, effective actions, and revision state", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.searchParams.get("action") === "wbgetentities") {
        return Response.json({
          entities: {
            Q42: {
              id: "Q42",
              lastrevid: 50,
              claims: {
                P2: [{
                  rank: "normal",
                  mainsnak: {
                    snaktype: "value",
                    datavalue: { value: { id: "Q512006" } },
                  },
                }],
                P251: [{
                  rank: "normal",
                  mainsnak: {
                    snaktype: "value",
                    datavalue: { value: canonicalUrl },
                  },
                }],
                P69: [{
                  rank: "normal",
                  mainsnak: {
                    snaktype: "value",
                    datavalue: { value: "https://example.test/edition" },
                  },
                }],
              },
            },
          },
        });
      }
      return Response.json({
        curtimestamp: "2026-09-29T10:00:00Z",
        query: {
          userinfo: {
            id: 17,
            name: "Editor",
            rights: ["edit", "createpage"],
          },
          tokens: { csrftoken: "csrf-token-value" },
          pages: [
            { pageid: 42, ns: 120, title: "Item:Q42", actions: { edit: true } },
            { ns: 0, title: "D-Q42", missing: true, actions: { edit: true } },
          ],
        },
      });
    });
    const provider = createTranscriptionCreationProvider({ fetch: fetchMock });

    const result = await provider.inspect("token", qid, identity);

    expect(result).toMatchObject({
      qid: "Q42",
      entityRevisionId: 50,
      isCatalogueMember: true,
      p251Values: [canonicalUrl],
      p69Values: ["https://example.test/edition"],
      entityEditable: true,
      page: { exists: false, title: "D-Q42", namespace: 0, editable: true },
    });
    const queryUrl = [...fetchMock.mock.calls]
      .map(([input]) => new URL(String(input)))
      .find((url) => url.searchParams.get("action") === "query");
    expect(queryUrl?.searchParams.get("intestactionsautocreate")).toBe("1");
    expect(queryUrl?.searchParams.get("titles")).toBe("Item:Q42|D-Q42");
  });

  it("deduplicates a current canonical P251 link without a write", async () => {
    const fetchMock = vi.fn();
    const provider = createTranscriptionCreationProvider({ fetch: fetchMock });

    const result = await provider.linkPage({
      accessToken: "token",
      inspection: inspection({ p251Values: [canonicalUrl] }),
      identity,
      url: canonicalUrl,
      summary: "Link document",
    });

    expect(result).toEqual({ revisionId: 50 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
