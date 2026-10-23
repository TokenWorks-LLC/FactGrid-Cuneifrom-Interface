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
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ signedOut: true, serverSessionRevoked: true }) });
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

test("facet search finds holding and period values outside the current results page", async ({ page }) => {
  await page.goto("/browse?q=Prag+I+437");
  const collection = page.getByLabel("Collection / holding", { exact: true });
  await expect(collection.locator('option:has-text("University of Jena")')).toHaveCount(0);

  await page.getByLabel("Find more holdings by name").fill("University of Jena");
  await expect(collection.locator('option[value="Q21880"]')).toHaveText("Friedrich-Schiller-University Jena (Q21880)");
  await collection.selectOption("Q21880");
  await page.getByRole("button", { name: "Apply search" }).click();
  await expect(page).toHaveURL(/collection=Q21880/);
  await expect(collection).toHaveValue("Q21880");
  await expect(page.getByRole("link", { name: "TEST FIXTURE — Jena tablet", exact: true })).toBeVisible();

  await page.goto("/browse?q=Prag+I+437");
  const period = page.getByLabel("Period / style", { exact: true });
  await expect(period.locator('option:has-text("Ur III Period")')).toHaveCount(0);
  await page.getByLabel("Find more periods by name").fill("Ur III Period");
  await expect(period.locator('option[value="Q512148"]')).toHaveText("Ur III Period (Q512148)");
  await period.selectOption("Q512148");
  await page.getByRole("button", { name: "Apply search" }).click();
  await expect(page).toHaveURL(/period=Q512148/);
  await expect(period).toHaveValue("Q512148");
  await expect(page.getByRole("link", { name: "TEST FIXTURE — Jena tablet", exact: true })).toBeVisible();
});

test("plain Transcript-section poems remain readable", async ({ page }) => {
  await page.goto("/tablets/Q9000002");

  await expect(page.getByText("a-na EN", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/Editing is not configured for this deployment/)).toBeVisible();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("Unicode editions offer a font choice in the edition and comparison views", async ({ page }) => {
  await page.goto("/tablets/Q9000002");

  await page.locator("#edition-4 summary").click();

  const edition = page.getByRole("combobox", { name: "Cuneiform font for Unicode edition" });
  await expect(edition).toHaveValue("automatic");
  await expect(edition.locator("option:checked")).toHaveText("Automatic (Noto Sans Cuneiform)");
  await edition.selectOption("old-babylonian");
  await expect(edition.locator("..").locator("..").locator("pre")).toHaveAttribute("data-unicode-font", "old-babylonian");

  const unicodeOption = await page.locator("#comparison-left option").filter({ hasText: "Cuneiform Unicode" }).getAttribute("value");
  expect(unicodeOption).not.toBeNull();
  await page.locator("#comparison-left").selectOption(unicodeOption!);
  const comparison = page.getByRole("combobox", { name: "Cuneiform font for left comparison" });
  await comparison.selectOption("neo-assyrian");
  await expect(comparison.locator("..").locator("..").locator("pre")).toHaveAttribute("data-unicode-font", "neo-assyrian");
});
