import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

test("a catalogue refresh restarts pagination while preserving filters", async ({ page }) => {
  await page.goto("/browse?q=PaginationFixture&collection=Q9200001&page=2&snapshot=2026-11-12T00%3A00%3A00Z");
  await expect(page.getByText("The catalogue was refreshed.", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Collection / holding", { exact: true })).toHaveValue("Q9200001");
  await expect(page.getByRole("link", { name: "Next", exact: true })).toHaveAttribute("href", /snapshot=/);
  await expect(page.getByRole("link", { name: "Previous", exact: true })).toHaveCount(0);
});

const capturedDocument = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/factgrid/live-q894483-document.json"), "utf8"));
const capturedSource: string = capturedDocument.query.pages[0].revisions[0].slots.main.content;
const expectedAtf = capturedSource.slice(capturedSource.indexOf("<poem>") + "<poem>".length, capturedSource.indexOf("</poem>"));

test("HS 751 opens its verified ATF edition without changing scholarly notation", async ({ page }) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) mutations.push(request.url());
  });
  const response = await page.goto("/tablets/Q894483#edition-1");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cuneiform Tablet HS 751");
  const edition = page.locator("#edition-1");
  await expect(edition.getByRole("heading", { name: "CDLI ATF transliteration" })).toBeVisible();
  const text = edition.locator("pre.transcript-text");
  await expect(text).toBeVisible();
  expect(await text.textContent()).toBe(expectedAtf);
  await expect(edition.getByRole("link", { name: "Source page", exact: true })).toHaveAttribute("href", "https://database.factgrid.de/wiki/CDLI-ATF-L-Q894483");
  await expect(edition.getByText(/Revision\s+20109826/)).toBeVisible();
  await expect(edition.locator("textarea")).toHaveCount(0);
  await expect(edition.getByRole("button", { name: /Edit|Save/ })).toHaveCount(0);
  expect(mutations).toEqual([]);
  expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("a failed first edition leaves metadata and a deep-linked second edition available", async ({ page }) => {
  await page.goto("/tablets/Q9000004#edition-2");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("TEST FIXTURE partial edition failure");
  await expect(page.locator("#edition-1")).toContainText(/could not|unavailable|invalid|incomplete|revision/i);
  const second = page.locator("#edition-2");
  await expect(second.locator("details")).toHaveAttribute("open", "");
  await expect(second.locator("pre")).toContainText("PTEST002:obverse.1.1");
  await expect(page.getByRole("button", { name: "Retry sources", exact: true })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Open authoritative record" })).toHaveAttribute("href", "https://database.factgrid.de/wiki/Item:Q9000004");
});

test("missing linked documents remain explicit while the tablet is readable", async ({ page }) => {
  const response = await page.goto("/tablets/Q9000003#edition-1");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("TEST FIXTURE");
  await expect(page.locator("#edition-1")).toContainText("Missing page");
  await expect(page.locator("#edition-1").getByRole("link", { name: "Source page", exact: true })).toHaveAttribute("href", "https://database.factgrid.de/wiki/D-Q9000003");
});

test("catalogue-wide findspot and period values are available beyond the first page", async ({ page }) => {
  await page.goto("/browse?q=PaginationFixture");
  await expect(page.getByRole("link", { name: "TEST FIXTURE PaginationFixture 25", exact: true })).toHaveCount(0);
  await page.getByLabel("Find more finding spots by name").fill("distant");
  const findspot = page.getByLabel("Finding spot", { exact: true });
  await expect(findspot.locator('option[value="Q9200002"]')).toContainText("distant findspot");
  await findspot.selectOption("Q9200002");
  await page.getByLabel("Find more periods by name").fill("distant");
  const period = page.getByLabel("Period / style", { exact: true });
  await expect(period.locator('option[value="Q9200003"]')).toContainText("distant period");
  await period.selectOption("Q9200003");
  await page.getByRole("button", { name: "Apply search" }).click();
  await expect(page).toHaveURL(/findspot=Q9200002/);
  await expect(page).toHaveURL(/period=Q9200003/);
  await expect(page.getByRole("link", { name: "TEST FIXTURE PaginationFixture 25", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Next", exact: true })).toHaveCount(0);
});

test("active catalogue filters persist across pagination without repeated records", async ({ page }) => {
  await page.goto("/browse?q=PaginationFixture&collection=Q9200001");
  const firstPageLinks = await page.locator('section ol article a[href^="/tablets/"]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href")))]);
  expect(firstPageLinks).toHaveLength(20);
  await page.getByRole("link", { name: "Next", exact: true }).click();
  await expect(page).toHaveURL(/collection=Q9200001/);
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByLabel("Collection / holding", { exact: true })).toHaveValue("Q9200001");
  const secondPageLinks = await page.locator('section ol article a[href^="/tablets/"]').evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href")))]);
  expect(secondPageLinks).toHaveLength(5);
  expect(secondPageLinks.some((href) => firstPageLinks.includes(href))).toBe(false);
  await expect(page.getByRole("link", { name: "Next", exact: true })).toHaveCount(0);
});

test("unrelated and missing FactGrid items have distinct explanations", async ({ page }) => {
  await page.goto("/tablets/Q9999999");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This item is not a supported tablet");
  await expect(page.getByRole("link", { name: "Open FactGrid record", exact: true })).toHaveAttribute("href", "https://database.factgrid.de/wiki/Item:Q9999999");
  await expect(page.getByRole("navigation", { name: "Edition index" })).toHaveCount(0);
  await page.goto("/tablets/Q9999998");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This tablet record is not available");
});

test("catalogue filters can be searched and selected with the keyboard", async ({ page }) => {
  await page.goto("/browse?q=PaginationFixture");
  const search = page.getByLabel("Find more finding spots by name");
  await search.focus();
  await page.keyboard.type("distant");
  const select = page.getByLabel("Finding spot", { exact: true });
  await expect(select.locator('option[value="Q9200002"]')).toBeAttached();
  await select.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("Q9200002");
  await page.getByRole("button", { name: "Apply search" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/findspot=Q9200002/);
  await expect(page.getByRole("link", { name: "TEST FIXTURE PaginationFixture 25", exact: true })).toBeVisible();
});

test("large holding lists expose later values without filling an unbounded select", async ({ page }) => {
  await page.goto("/browse?q=PaginationFixture");
  const select = page.getByLabel("Collection / holding", { exact: true });
  await expect(page.getByRole("button", { name: "More collection / holding values", exact: true })).toBeVisible();
  expect(await select.locator("option").count()).toBeLessThanOrEqual(51);
  await expect(select.locator('option[value="Q9300060"]')).toHaveCount(0);
  await page.getByRole("button", { name: "More collection / holding values", exact: true }).click();
  await expect(select.locator('option[value="Q9300060"]')).toHaveText("TEST FIXTURE holding 060 (Q9300060)");
  await select.selectOption("Q9300060");
  await page.getByRole("button", { name: "Apply search" }).click();
  await expect(page).toHaveURL(/collection=Q9300060/);
  await expect(page.getByRole("link", { name: "TEST FIXTURE PaginationFixture 25", exact: true })).toBeVisible();
  await expect(select).toHaveValue("Q9300060");
});
