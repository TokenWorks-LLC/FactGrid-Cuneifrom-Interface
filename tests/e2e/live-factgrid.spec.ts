import { expect, test } from "@playwright/test";

test("live catalogue search opens the multi-edition Prag record", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/browse?q=Prag+I+437");
  await page.getByLabel("Collection / holding").selectOption("Q512014");
  await page.getByRole("button", { name: "Apply search" }).click();
  await expect(page).toHaveURL(/collection=Q512014/);
  const result = page.getByRole("link", { name: /Prag I 437$/ }).first();
  await expect(result).toHaveAttribute("href", "/tablets/Q499899");
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
  await expect(page.getByText(/not on this deployment.*approved edit-target list/)).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});
