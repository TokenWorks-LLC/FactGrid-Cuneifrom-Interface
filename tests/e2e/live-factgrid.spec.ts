import { expect, test } from "@playwright/test";

test("live catalogue search opens the multi-edition Prag record", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/browse?q=Prag+I+437");
  await page.getByLabel("Collection / holding").selectOption("Q512014");
  await page.getByRole("button", { name: "Apply search" }).click();
  await expect(page).toHaveURL(/collection=Q512014/);
  const result = page.getByRole("link", { name: /Prag I 437$/ }).first();
  await expect(result).toHaveAttribute("href", /^\/tablets\/Q499899\?returnTo=/);
  await result.click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Prag I 437");
  await expect(page.getByRole("heading", { name: "Compare two editions" })).toBeVisible();
  await expect(page.getByText("I 437", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Edition index" })).toBeVisible();
});

test("live plain Transcript-section poems remain readable", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/tablets/Q1089841");

  await expect(page.getByText("ap-pa-tu", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Editing is not configured for this deployment/)).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("live HS 751 has a readable read-only linked ATF edition", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/tablets/Q894483#edition-1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("HS 751");
  const edition = page.locator("#edition-1");
  await expect(edition.getByRole("heading", { name: "CDLI ATF transliteration" })).toBeVisible();
  await expect(edition.locator("pre")).toContainText("&P020415");
  await expect(edition.locator("pre")).toContainText("#atf: lang sux");
  await expect(edition.locator("pre")).toContainText("@obverse");
  await expect(edition.locator("pre")).toContainText("@reverse");
  await expect(edition.getByRole("link", { name: "Source page", exact: true })).toHaveAttribute(
    "href", "https://database.factgrid.de/wiki/CDLI-ATF-L-Q894483",
  );
  await expect(edition.getByRole("button", { name: /edit/i })).toHaveCount(0);
});

test("live sparse, Ur III, structured and external-source records retain metadata", async ({ page }) => {
  test.setTimeout(120_000);
  for (const qid of ["Q894307", "Q892185", "Q1361363", "Q471142"]) {
    await page.goto(`/tablets/${qid}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cuneiform Tablet");
    await expect(page.getByRole("link", { name: "Open authoritative record" })).toHaveAttribute(
      "href", `https://database.factgrid.de/wiki/Item:${qid}`,
    );
  }
});
