import { expect, test } from "@playwright/test";

test("homepage exposes the catalogue journey and source attribution", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.headers()["content-security-policy"]).toContain("object-src 'none'");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Read the record. Follow the source.",
  );
  await expect(page.getByRole("search")).toBeVisible();
  await expect(page.getByRole("link", { name: /Photograph: Rama/ })).toHaveAttribute(
    "href",
    /commons\.wikimedia\.org/,
  );

  await page.getByLabel("Search tablets by name, QID, or identifier").fill("Prag I 437");
  await page.getByRole("button", { name: "Search catalogue" }).click();
  await expect(page).toHaveURL(/\/browse\?q=Prag(?:\+|%20)I(?:\+|%20)437$/);
});

test("about page states authority and editing limits", async ({ page }) => {
  await page.goto("/about");

  await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
  await expect(page.getByText("FactGrid is the authoritative source", { exact: false })).toBeVisible();
  await expect(page.getByText("Authentication alone never grants edit access.")).toBeVisible();
  await expect(page.getByRole("link", { name: "About", exact: true }).first()).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("reading mode is explicit when OAuth is not configured", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: /Reading only/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse tablets" }).first()).toBeVisible();
});

test("mobile navigation and primary search remain operable", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only layout assertion");

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary mobile" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse", exact: true })).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
});

test("catalogue search opens a multi-edition tablet", async ({ page }) => {
  await page.goto("/browse?q=Prag+I+437");
  await page.getByLabel("Name or identifier").fill("TEST FIXTURE");
  await page.getByLabel("Collection / holding").selectOption("Q9000100");
  await page.getByRole("button", { name: "Apply search" }).click();
  await expect(page).toHaveURL(/collection=Q9000100/);
  const result = page.getByRole("link", { name: /TEST FIXTURE.*tablet with editions/ }).first();
  await expect(result).toHaveAttribute("href", "/tablets/Q9000002");
  await result.click();

  await expect(page.getByRole("heading", { level: 1 })).toContainText("TEST FIXTURE");
  await expect(page.getByRole("heading", { name: "Compare two editions" })).toBeVisible();
  await expect(page.getByText("a-na EN", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Edition index" })).toBeVisible();
  await page.locator("#comparison-left").selectOption("1");
  await expect(page.locator("#comparison-left + pre")).toContainText("PTEST002:obverse.1.1");
});

test("plain Transcript-section poems remain readable", async ({ page }) => {
  await page.goto("/tablets/Q9000002");

  await expect(page.getByText("a-na EN", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/not on this deployment.*approved edit-target list/)).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
