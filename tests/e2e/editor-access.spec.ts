import { expect, test, type Page } from "@playwright/test";

function recordMutations(page: Page): string[] {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      mutations.push(`${request.method()} ${request.url()}`);
    }
  });
  return mutations;
}

async function expectNoEditorControls(page: Page) {
  await expect(page.locator("main input, main textarea, main select")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save to FactGrid|Review and save|Create and link/ })).toHaveCount(0);
}

for (const qid of ["Q9000001", "Q9000002"]) {
  test(`anonymous visitors must sign in before opening the ${qid} editor`, async ({ page }) => {
    const mutations = recordMutations(page);
    const metadataRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes(`/api/tablets/${qid}/metadata`)) metadataRequests.push(request.url());
    });
    await page.route("**/api/session", (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify({ authenticated: false }),
    }));
    await page.goto(`/tablets/${qid}`);
    await page.getByRole("link", { name: "Edit record" }).click();
    await expect(page).toHaveURL(new RegExp(`/tablets/${qid}/edit$`));
    await expect(page.getByRole("heading", { name: "Sign in to edit", exact: true })).toBeVisible();
    const login = page.locator("main").getByRole("link", { name: "Log in with FactGrid", exact: true });
    await expect(login).toHaveAttribute("href", `/api/auth/login?returnTo=${encodeURIComponent(`/tablets/${qid}/edit`)}`);
    await login.focus();
    await expect(login).toBeFocused();
    await expectNoEditorControls(page);
    expect(metadataRequests).toEqual([]);
    expect(mutations).toEqual([]);
    expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
}

for (const scenario of [
  { name: "unconfigured", status: 503, session: {}, title: "Editing unavailable" },
  { name: "disabled", status: 200, session: { authenticated: true, csrfToken: "fixture-csrf", editingEnabled: false, editorApproved: true }, title: "Editing disabled" },
  { name: "denied", status: 200, session: { authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: false }, title: "Editing not permitted" },
  { name: "missing CSRF", status: 200, session: { authenticated: true, editingEnabled: true, editorApproved: true }, title: "Editing not permitted" },
]) {
  test(`${scenario.name} access never falls back to public draft controls`, async ({ page }) => {
    const mutations = recordMutations(page);
    await page.route("**/api/session", (route) => route.fulfill({
      status: scenario.status, contentType: "application/json", body: JSON.stringify(scenario.session),
    }));
    await page.goto("/tablets/Q9000001/edit");
    await expect(page.getByRole("heading", { name: scenario.title, exact: true })).toBeVisible();
    await expectNoEditorControls(page);
    expect(mutations).toEqual([]);
    if (scenario.name === "unconfigured") {
      await expect(page.locator("main").getByRole("link", { name: "About FactGrid sign-in" })).toHaveAttribute("href", "/about#sign-in-availability");
    }
  });
}

test("loading and failed metadata requests never expose a substitute editor", async ({ page }) => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true }),
  }));
  await page.route("**/api/tablets/Q9000001/metadata*", async (route) => {
    await pending;
    await route.fulfill({ status: 502, contentType: "application/json", body: "{}" });
  });
  await page.goto("/tablets/Q9000001/edit");
  try {
    await expect(page.getByRole("heading", { name: "Checking edit access", exact: true })).toBeVisible();
    await expectNoEditorControls(page);
  } finally {
    release();
  }
  await expect(page.getByRole("heading", { name: "Editor could not be loaded", exact: true })).toBeVisible();
  await expectNoEditorControls(page);
});

test("authenticated eligible accounts can review and save multilingual metadata", async ({ page }) => {
  let savedBody: Record<string, unknown> | undefined;
  const entity = {
    id: "Q9000002",
    lastRevision: 44,
    labels: { en: "Fixture tablet" },
    descriptions: { en: "A fixture description" },
    aliases: { en: ["Fixture alias"] },
    sitelinks: {},
    statements: [{ id: "Q9000002$INSTANCE", rank: "normal", mainsnak: { property: "P2", datatype: "wikibase-item", snaktype: "value", value: { kind: "entity", id: "Q512006", entityType: "item" } }, qualifiers: {}, qualifierOrder: [], references: [] }],
  };
  const properties = { P2: { id: "P2", datatype: "wikibase-item", label: "Instance of", supported: true } };
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { username: "Fixture Editor" } }),
  }));
  await page.route("**/api/tablets/Q9000002/metadata*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity, properties }) });
      return;
    }
    savedBody = route.request().postDataJSON() as Record<string, unknown>;
    const savedEntity = { ...entity, lastRevision: 45, labels: { en: "Updated fixture tablet", de: "Tontafel" } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity: savedEntity, properties, revisionId: 45, message: "Saved fixture metadata." }) });
  });
  await page.goto("/tablets/Q9000002/edit");
  await expect(page.getByLabel("Signed in as Fixture Editor")).toBeVisible();
  await expect(page.getByText("Editing FactGrid", { exact: true })).toBeVisible();
  await page.getByLabel("Label", { exact: true }).fill("Updated fixture tablet");
  await page.getByLabel("Add language code").first().fill("de");
  await page.getByRole("button", { name: "Add language" }).first().click();
  await page.getByRole("group", { name: "Labels" }).getByLabel("Label", { exact: true }).first().fill("Tontafel");
  await page.getByRole("button", { name: "Review and save" }).click();
  await expect(page.getByRole("dialog", { name: "Review changes before saving" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm and save" }).click();
  await expect(page.getByText("Save confirmed", { exact: true })).toBeVisible();
  expect(savedBody).toMatchObject({ baseRevision: 44, confirmRemovals: false });
  expect(savedBody?.operations).toEqual(expect.arrayContaining([
    { type: "set-label", language: "en", value: "Updated fixture tablet" },
    { type: "set-label", language: "de", value: "Tontafel" },
  ]));
});

test("authenticated eligible accounts can create and link a missing transcription", async ({ page }) => {
  let creationBody: Record<string, unknown> | undefined;
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { username: "Fixture Editor" } }) }));
  await page.route("**/api/tablets/Q9000001/metadata*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity: { id: "Q9000001", lastRevision: 12, labels: { en: "Sparse tablet" }, descriptions: {}, aliases: {}, sitelinks: {}, statements: [] }, properties: {} }) }));
  await page.route("**/api/tablets/Q9000001/transcription", async (route) => {
    creationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ status: "created_and_linked", title: "D-Q9000001", url: "https://database.factgrid.de/wiki/D-Q9000001", pageRevisionId: 88, entityRevisionId: 13 }) });
  });
  await page.goto("/tablets/Q9000001/edit");
  await page.getByRole("textbox", { name: "Transliteration source", exact: true }).fill("1. a-na EN");
  await page.getByRole("button", { name: "Create and link on FactGrid" }).click();
  await expect(page.getByText("Creation confirmed", { exact: true })).toBeVisible();
  expect(creationBody).toMatchObject({ text: "1. a-na EN" });
});
