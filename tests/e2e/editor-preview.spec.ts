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

test("anonymous users can preview metadata and transcripts without submitting writes", async ({ page }) => {
  const mutations = recordMutations(page);
  await page.goto("/tablets/Q9000002");
  await page.getByRole("link", { name: "Edit record" }).click();
  await expect(page).toHaveURL(/\/tablets\/Q9000002\/edit$/);
  await expect(page.getByRole("heading", { level: 1, name: "Edit tablet record" })).toBeVisible();
  await expect(page.getByText("Local draft preview", { exact: true })).toBeVisible();

  const title = page.getByRole("textbox", { name: "Record title", exact: true });
  const originalTitle = await title.inputValue();
  const literalMarkup = '<img src=x onerror="alert(1)"> š';
  await title.fill(literalMarkup);
  await expect(page.getByRole("region", { name: "Metadata preview" })).toContainText(literalMarkup);
  await expect(page.getByRole("region", { name: "Metadata preview" }).locator("img")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("A local metadata draft.");
  await page.getByRole("textbox", { name: "Inventory numbers", exact: true }).fill("PREVIEW-1\nPREVIEW-2");
  await expect(page.getByRole("button", { name: "Save metadata", exact: true })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset metadata draft" }).click();
  await expect(title).toHaveValue(originalTitle);

  const transcript = page.getByRole("textbox", { name: "Transliteration source", exact: true });
  const initialTranscript = await transcript.inputValue();
  await transcript.fill(literalMarkup);
  await expect(page.getByLabel("Plain-text preview", { exact: true }).filter({ visible: true })).toHaveText(literalMarkup);
  await page.getByRole("button", { name: "Insert ḫ", exact: true }).click();
  await expect(transcript).toHaveValue(`${literalMarkup}ḫ`);
  await expect(page.getByRole("button", { name: "Save to FactGrid", exact: true })).toBeDisabled();
  await page.getByRole("combobox", { name: "Edition to preview" }).selectOption("1");
  await expect(page.getByText("Its source format remains read-only", { exact: false }).filter({ visible: true })).toBeVisible();
  await transcript.fill("Second edition draft");
  await page.getByRole("combobox", { name: "Edition to preview" }).selectOption("0");
  await expect(transcript).toHaveValue(`${literalMarkup}ḫ`);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset transcript draft" }).click();
  await expect(transcript).toHaveValue(initialTranscript);

  expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(mutations).toEqual([]);
});

test("a tablet without a transcript still exposes a blank public editing preview", async ({ page }) => {
  const mutations = recordMutations(page);
  await page.goto("/tablets/Q9000001");
  await expect(page.getByRole("heading", { name: "No transcript is linked" })).toBeVisible();
  await page.getByRole("link", { name: "Edit record" }).click();
  await expect(page.getByRole("heading", { name: "Try metadata changes", exact: true })).toBeVisible();
  await expect(page.getByText("No local transcript is linked", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "Transliteration source", exact: true }).fill("An empty-record practice draft.");
  await expect(page.getByLabel("Plain-text preview", { exact: true })).toHaveText("An empty-record practice draft.");
  await expect(page.getByRole("button", { name: "Save to FactGrid", exact: true })).toBeDisabled();
  expect(mutations).toEqual([]);
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
