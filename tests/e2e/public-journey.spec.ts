import { expect, test } from "@playwright/test";

test("homepage exposes the catalogue journey and source attribution", async ({ page }) => {
  await page.goto("/");

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
});

test("reading mode is explicit when OAuth is not configured", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Reading mode")).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse tablets" }).first()).toBeVisible();
});

test("mobile navigation and primary search remain operable", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only layout assertion");

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary mobile" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse", exact: true })).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
});
