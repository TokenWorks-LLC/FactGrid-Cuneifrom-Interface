import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

import type { TabletEdition } from "@/lib/factgrid/types";
import { getAuthConfiguration } from "@/lib/auth/config";
import { providerAuthorizationHeader } from "@/lib/auth/oauth";

import {
  createMediaWikiEditClient,
  saveTranscript,
  type MediaWikiEditClient,
} from "./factgrid-write";
import { parseAllowedEditTargets } from "./targets";

const source =
  "prefix\r\n<poem property=\"http://www.purl.org/cuneiform/hasTransliteration\">\r\nold line\r\n</poem>\r\nsuffix\r\n";
const updatedSource =
  "prefix\r\n<poem property=\"http://www.purl.org/cuneiform/hasTransliteration\">new line\nša</poem>\r\nsuffix\r\n";

const edition: TabletEdition = {
  editionId: "Q42$A1-B2",
  kind: "d",
  label: "Scholarly edition",
  status: "linked",
  reference: {
    kind: "d",
    qid: "Q42",
    title: "D-Q42",
    url: "https://database.factgrid.de/wiki/D-Q42",
  },
};

const identity = { providerUserId: "17", username: "Editor" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function page(
  revisionId: number,
  content: string,
  attribution: { user?: string; userid?: number; comment?: string } = {},
) {
  return {
    pageid: 123,
    ns: 0,
    title: "D-Q42",
    lastrevid: revisionId,
    protection: [],
    actions: { edit: true },
    revisions: [
      {
        revid: revisionId,
        parentid: revisionId - 1,
        timestamp: "2026-09-20T10:00:00Z",
        user: attribution.user ?? "Editor",
        userid: attribution.userid ?? 17,
        comment: attribution.comment ?? "Correct line",
        slots: {
          main: {
            contentmodel: "wikitext",
            contentformat: "text/x-wiki",
            content,
          },
        },
      },
    ],
  };
}

function inspection(overrides: Record<string, unknown> = {}) {
  return {
    curtimestamp: "2026-09-20T10:01:00Z",
    query: {
      userinfo: {
        id: 17,
        name: "Editor",
        groups: ["user"],
        rights: ["read", "edit"],
      },
      tokens: { csrftoken: "provider-csrf-token" },
      pages: [page(100, source)],
    },
    ...overrides,
  };
}

async function inspected(client: MediaWikiEditClient) {
  return client.inspectEdition("access-token", edition, identity);
}

describe("FactGrid MediaWiki transcript writes", () => {
  it("signs inspection, Unicode form edits, and readback with OAuth 1.0a credentials", async () => {
    const result = getAuthConfiguration({
      APP_ORIGIN: "https://app.example",
      FACTGRID_OAUTH_CALLBACK_URL: "https://app.example/api/auth/callback",
      FACTGRID_OAUTH_VERSION: "1.0a",
      FACTGRID_OAUTH_CONSUMER_KEY: "consumer-key",
      FACTGRID_OAUTH_CONSUMER_SECRET: "consumer-secret",
      FACTGRID_SESSION_DB_PATH: ":memory:",
      SESSION_SECRET: "x".repeat(32),
    });
    if (!result.available) throw new Error("Invalid test configuration");
    const encode = (value: string) => encodeURIComponent(value).replace(
      /[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    let calls = 0;
    const nonces = new Set<string>();
    const fetchMock: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      const header = new Headers(init?.headers).get("authorization") ?? "";
      expect(header).toMatch(/^OAuth /u);
      expect(header).not.toContain("consumer-secret");
      expect(header).not.toContain("access-secret");
      const oauth = new Map([...header.matchAll(/(oauth_\w+)="([^"]*)"/gu)]
        .map((match) => [match[1], decodeURIComponent(match[2])]));
      expect(oauth.get("oauth_consumer_key")).toBe("consumer-key");
      expect(oauth.get("oauth_token")).toBe("access-token");
      expect(oauth.get("oauth_signature_method")).toBe("HMAC-SHA1");
      nonces.add(oauth.get("oauth_nonce")!);
      const signature = oauth.get("oauth_signature");
      oauth.delete("oauth_signature");
      const pairs = [...url.searchParams, ...oauth,
        ...(init?.body instanceof URLSearchParams ? [...init.body] : [])];
      const normalized = pairs.map(([key, value]) => [encode(key), encode(value)])
        .sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0)
        .map(([key, value]) => `${key}=${value}`).join("&");
      const base = [init?.method ?? "GET", `${url.origin}${url.pathname}`, normalized]
        .map(encode).join("&");
      expect(signature).toBe(createHmac("sha1", "consumer-secret&access-secret").update(base).digest("base64"));
      calls += 1;
      if (calls === 1) return json(inspection());
      if (calls === 2) return json({ edit: {
        result: "Success", pageid: 123, title: "D-Q42", oldrevid: 100, newrevid: 101,
      } });
      return json({ query: { pages: [page(101, updatedSource, { comment: "š + & = % / ?" })] } });
    };
    const client = createMediaWikiEditClient({
      fetch: fetchMock,
      authorizationHeader: (accessToken, method, url, body) => providerAuthorizationHeader(
        result.config, { accessToken, accessTokenSecret: "access-secret", oauthVersion: "1.0a" },
        method, url, body,
      ),
    });
    const snapshot = await inspected(client);
    await expect(client.submitEdit("access-token", snapshot, {
      baseRevision: 100, text: "new line\nša", summary: "š + & = % / ?",
    })).resolves.toEqual({ revisionId: 101, text: "new line\nša" });
    expect(calls).toBe(3);
    expect(nonces.size).toBe(3);
  });

  it("splices only the verified poem bytes, uses conflict parameters, and reads back", async () => {
    const calls: Array<{ input: URL; init?: RequestInit }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = input instanceof URL ? input : new URL(String(input));
      calls.push({ input: url, init });
      if (calls.length === 1) return json(inspection());
      if (calls.length === 2) {
        return json({
          edit: {
            result: "Success",
            pageid: 123,
            title: "D-Q42",
            oldrevid: 100,
            newrevid: 101,
            newtimestamp: "2026-09-20T10:02:00Z",
          },
        });
      }
      return json({ query: { pages: [page(101, updatedSource)] } });
    };
    const client = createMediaWikiEditClient({ fetch: fetchMock });
    const snapshot = await inspected(client);
    const result = await client.submitEdit("access-token", snapshot, {
      baseRevision: 100,
      text: "new line\nša",
      summary: "Correct line",
    });

    expect(result).toEqual({ revisionId: 101, text: "new line\nša" });
    expect(calls).toHaveLength(3);
    expect(calls[0].input.searchParams.get("intestactions")).toBe("edit");
    expect(calls[0].input.searchParams.get("uiprop")).toContain("blockinfo");
    expect(calls[0].init?.cache).toBe("no-store");

    const post = calls[1].init;
    expect(post?.method).toBe("POST");
    const form = post?.body as URLSearchParams;
    expect(form.get("title")).toBe("D-Q42");
    expect(form.get("text")).toBe(updatedSource);
    expect(form.get("assert")).toBe("user");
    expect(form.get("nocreate")).toBe("1");
    expect(form.get("baserevid")).toBe("100");
    expect(form.get("basetimestamp")).toBe("2026-09-20T10:00:00Z");
    expect(form.get("starttimestamp")).toBe("2026-09-20T10:01:00Z");
    expect(form.get("summary")).toBe("Correct line");
    expect(calls[2].init?.cache).toBe("no-store");
    expect(calls[2].input.searchParams.get("rvprop")).toContain("user");
    expect(calls[2].input.searchParams.get("rvprop")).toContain("comment");
  });

  it("returns a 409 before writing when the browser revision is stale", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      return json(inspection());
    };
    const client = createMediaWikiEditClient({ fetch: fetchMock });
    const snapshot = await inspected(client);

    await expect(
      client.submitEdit("access-token", snapshot, {
        baseRevision: 99,
        text: "draft",
        summary: "",
      }),
    ).rejects.toMatchObject({ code: "edit_conflict", status: 409 });
    expect(calls).toBe(1);
  });

  it("maps MediaWiki edit conflicts to 409 without retrying", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return json(inspection());
      return json({ error: { code: "editconflict", info: "Details not exposed" } });
    };
    const client = createMediaWikiEditClient({ fetch: fetchMock });
    const snapshot = await inspected(client);

    await expect(
      client.submitEdit("access-token", snapshot, {
        baseRevision: 100,
        text: "draft",
        summary: "",
      }),
    ).rejects.toMatchObject({ code: "edit_conflict", status: 409 });
    expect(calls).toBe(2);
  });

  it("reports an ambiguous write connection failure and never retries", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return json(inspection());
      throw new TypeError("connection reset after request transmission");
    };
    const client = createMediaWikiEditClient({ fetch: fetchMock });
    const snapshot = await inspected(client);

    await expect(
      client.submitEdit("access-token", snapshot, {
        baseRevision: 100,
        text: "draft",
        summary: "",
      }),
    ).rejects.toMatchObject({ code: "save_status_unknown" });
    expect(calls).toBe(2);
  });

  it("denies a blocked API identity and a page that fails the editability test", async () => {
    const blockedFetch: typeof fetch = async () =>
      json(
        inspection({
          query: {
            ...inspection().query,
            userinfo: {
              id: 17,
              name: "Editor",
              rights: ["read", "edit"],
              blockid: 9,
            },
          },
        }),
      );
    await expect(
      inspected(createMediaWikiEditClient({ fetch: blockedFetch })),
    ).rejects.toMatchObject({ code: "account_blocked", status: 403 });

    const protectedFetch: typeof fetch = async () => {
      const body = inspection();
      body.query.pages[0].actions.edit = false;
      (body.query.pages[0] as { protection: Array<Record<string, string>> }).protection = [
        { type: "edit", level: "sysop", expiry: "infinity" },
      ];
      return json(body);
    };
    await expect(
      inspected(createMediaWikiEditClient({ fetch: protectedFetch })),
    ).rejects.toMatchObject({ code: "page_not_editable", status: 403 });
  });

  it("does not report success when uncached readback differs", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return json(inspection());
      if (calls === 2) {
        return json({
          edit: {
            result: "Success",
            title: "D-Q42",
            newrevid: 101,
          },
        });
      }
      return json({ query: { pages: [page(102, `${updatedSource}newer change`)] } });
    };
    const client = createMediaWikiEditClient({ fetch: fetchMock });
    const snapshot = await inspected(client);

    await expect(
      client.submitEdit("access-token", snapshot, {
        baseRevision: 100,
        text: "new line\nša",
        summary: "",
      }),
    ).rejects.toMatchObject({ code: "save_confirmation_failed", status: 409 });
    expect(calls).toBe(3);
  });

  it.each([
    ["attribution", { user: "OtherEditor" }],
    ["user ID", { userid: 99 }],
    ["summary", { comment: "Different summary" }],
  ])("does not report success when readback %s differs", async (_label, attribution) => {
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return json(inspection());
      if (calls === 2) {
        return json({
          edit: {
            result: "Success",
            title: "D-Q42",
            newrevid: 101,
          },
        });
      }
      return json({
        query: { pages: [page(101, updatedSource, attribution)] },
      });
    };
    const client = createMediaWikiEditClient({ fetch: fetchMock });
    const snapshot = await inspected(client);

    await expect(
      client.submitEdit("access-token", snapshot, {
        baseRevision: 100,
        text: "new line\nša",
        summary: "Correct line",
      }),
    ).rejects.toMatchObject({ code: "save_confirmation_failed", status: 409 });
    expect(calls).toBe(3);
  });

  it("confirms an unchanged save without inventing new attribution or summary", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return json(inspection());
      if (calls === 2) {
        return json({
          edit: {
            result: "Success",
            title: "D-Q42",
            nochange: true,
          },
        });
      }
      return json({
        query: {
          pages: [
            page(100, source, {
              user: "OriginalEditor",
              userid: 3,
              comment: "Original summary",
            }),
          ],
        },
      });
    };
    const client = createMediaWikiEditClient({ fetch: fetchMock });
    const snapshot = await inspected(client);

    await expect(
      client.submitEdit("access-token", snapshot, {
        baseRevision: 100,
        text: "\r\nold line\r\n",
        summary: "No material change",
      }),
    ).resolves.toEqual({ revisionId: 100, text: "\r\nold line\r\n" });
    expect(calls).toBe(3);
  });

  it("enforces the exact QID and freshly resolved title allowlist before inspection", async () => {
    const inspectEdition = vi.fn();
    const mediaWiki = {
      inspectEdition,
      submitEdit: vi.fn(),
    } as unknown as MediaWikiEditClient;
    const resolveCurrentEdition = vi.fn().mockResolvedValue(edition);
    const input = {
      qid: "Q42",
      editionId: "Q42$A1-B2",
      accessToken: "access-token",
      identity,
      request: { baseRevision: 100, text: "draft", summary: "" },
    };

    await expect(
      saveTranscript(input, {
        factGrid: { resolveCurrentEdition },
        mediaWiki,
        allowedTargets: parseAllowedEditTargets("Q42|UNICODE-W-Q42"),
      }),
    ).rejects.toMatchObject({ code: "target_not_allowed", status: 403 });
    expect(resolveCurrentEdition).toHaveBeenCalledWith("Q42", "Q42$A1-B2");
    expect(inspectEdition).not.toHaveBeenCalled();
  });
});
