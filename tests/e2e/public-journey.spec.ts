import { expect, test, type Locator, type Page } from "@playwright/test";

function authNavigation(page: Page): Locator {
  return page.getByRole("navigation", {
    name: "Primary",
    exact: true,
  });
}

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

test("FactGrid login stays visible and explains an unavailable deployment", async ({ page }) => {
  await page.goto("/about?from=login-test");

  const navigation = authNavigation(page);
  const login = navigation.getByRole("link", { name: "Log in with FactGrid", exact: true });
  await expect(login).toBeVisible();
  await expect(login).toHaveAccessibleDescription("Unavailable");
  await expect(login).toHaveAttribute("href", "/about#sign-in-availability");

  await login.focus();
  await expect(login).toBeFocused();
  const explanationNavigation = page.waitForURL(/\/about#sign-in-availability$/);
  await Promise.all([page.keyboard.press("Enter"), explanationNavigation]);
  const explanationHeading = page.getByRole("heading", { name: "FactGrid sign-in" });
  await expect(explanationHeading).toBeVisible();
  const [headerBox, headingBox] = await Promise.all([
    page.locator("header").boundingBox(),
    explanationHeading.boundingBox(),
  ]);
  expect(headerBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(headingBox!.y).toBeGreaterThanOrEqual(Math.max(0, headerBox!.y + headerBox!.height));
  await expect(page.getByText("Public browsing remains available.", { exact: false })).toBeVisible();
});

test("configured anonymous login preserves the current internal destination", async ({ page }) => {
  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ authenticated: false }),
    });
  });
  await page.goto("/about?from=login-test");

  const login = authNavigation(page).getByRole("link", {
    name: "Log in with FactGrid",
    exact: true,
  });
  await expect(login).toBeVisible();
  await expect.poll(async () => {
    const href = await login.getAttribute("href");
    return href ? new URL(href, "http://localhost:3000").searchParams.get("returnTo") : null;
  }).toBe("/about?from=login-test");
});

test("authenticated account and logout controls render through an isolated browser fixture", async ({ page }) => {
  let logoutRequests = 0;
  let loggedOut = false;
  let completeLogout: (() => void) | undefined;
  const logoutPending = new Promise<void>((resolve) => {
    completeLogout = resolve;
  });
  await page.route("**/api/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        loggedOut
          ? { authenticated: false }
          : {
              authenticated: true,
              csrfToken: "fixture-csrf-token",
              user: { username: "Fixture Editor" },
            },
      ),
    });
  });
  await page.route("**/api/auth/logout", async (route) => {
    logoutRequests += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBe("fixture-csrf-token");
    loggedOut = true;
    await logoutPending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto("/about");

  const navigation = authNavigation(page);
  await expect(navigation.getByLabel("Signed in as Fixture Editor")).toBeVisible();
  const signOut = navigation.getByRole("button");
  await expect(signOut).toHaveAccessibleName("Sign out");
  const logoutClick = signOut.click();
  await expect(signOut).toBeDisabled();
  await expect(signOut).toHaveAccessibleName("Signing out…");
  const returnedHome = page.waitForURL("/");
  completeLogout?.();
  await Promise.all([logoutClick, returnedHome]);

  expect(logoutRequests).toBe(1);
  await expect(navigation.getByLabel("Signed in as Fixture Editor")).toHaveCount(0);
  await expect(
    authNavigation(page).getByRole("link", {
      name: "Log in with FactGrid",
      exact: true,
    }),
  ).toBeVisible();
});

test("mobile navigation and primary search remain operable", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only layout assertion");

  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
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
