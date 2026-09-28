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
  await page.getByRole("link", { name: "Preview editor" }).click();
  await expect(page).toHaveURL(/\/tablets\/Q9000002\/edit$/);
  await expect(page.getByRole("heading", { level: 1, name: "Editor preview" })).toBeVisible();
  await expect(page.getByText("Everyone can try this interface.", { exact: false })).toBeVisible();

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
  await page.getByRole("link", { name: "Preview editor" }).click();
  await expect(page.getByRole("heading", { name: "Edit metadata", exact: true })).toBeVisible();
  await expect(page.getByText("No local transcript can be previewed", { exact: false })).toBeVisible();
  await page.getByRole("textbox", { name: "Transliteration source", exact: true }).fill("An empty-record practice draft.");
  await expect(page.getByLabel("Plain-text preview", { exact: true })).toHaveText("An empty-record practice draft.");
  await expect(page.getByRole("button", { name: "Save to FactGrid", exact: true })).toBeDisabled();
  expect(mutations).toEqual([]);
});

test("authenticated approved accounts also remain in preview mode on the public editor page", async ({ page }) => {
  const mutations = recordMutations(page);
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { username: "Fixture Editor" } }),
  }));
  await page.goto("/tablets/Q9000002/edit");
  await expect(page.getByLabel("Signed in as Fixture Editor")).toBeVisible();
  await page.getByRole("textbox", { name: "Transliteration source", exact: true }).fill("Still a preview draft.");
  await expect(page.getByRole("button", { name: "Save to FactGrid", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save metadata", exact: true })).toBeDisabled();
  expect(mutations).toEqual([]);
});
