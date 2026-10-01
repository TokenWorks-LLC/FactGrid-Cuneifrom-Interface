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

for (const qid of ["Q9000001", "Q9000002", "Q9000003"]) {
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
  { name: "disabled", status: 200, session: { authenticated: true, csrfToken: "fixture-csrf", editingEnabled: false, editorApproved: true, user: { id: "17" } }, title: "Editing disabled" },
  { name: "denied", status: 200, session: { authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: false, user: { id: "17" } }, title: "Editing not permitted" },
  { name: "missing CSRF", status: 200, session: { authenticated: true, editingEnabled: true, editorApproved: true, user: { id: "17" } }, title: "Editing not permitted" },
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
    contentType: "application/json", body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { id: "17" } }),
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
  const properties = {
    P2: { id: "P2", datatype: "wikibase-item", label: "Instance of", supported: true },
    P251: { id: "P251", datatype: "url", label: "Document page", supported: false, readOnlyReason: "Document links are managed by the transcription workflow." },
  };
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { id: "17", username: "Fixture Editor" } }),
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
  await expect(page.getByRole("heading", { name: "Add transcription", exact: true })).toHaveCount(0);
  const propertyInput = page.getByLabel("Add statement property");
  await propertyInput.fill("P251");
  await propertyInput.locator("..").locator("..").getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Document links are managed by the transcription workflow.")).toBeVisible();
  await page.getByLabel("Label", { exact: true }).fill("Updated fixture tablet");
  await page.getByLabel("Add language code").first().fill("de");
  await page.getByRole("button", { name: "Add language" }).first().click();
  await page.getByRole("group", { name: "Labels" }).getByLabel("Label", { exact: true }).first().fill("Tontafel");
  await page.getByRole("button", { name: "Review and save" }).click();
  const reviewButton = page.getByRole("button", { name: "Review and save" });
  const dialog = page.getByRole("alertdialog", { name: "Review changes before saving" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm and save" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Keep editing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(reviewButton).toBeFocused();
  await reviewButton.click();
  await page.getByRole("button", { name: "Confirm and save" }).click();
  await expect(page.getByText("Save confirmed", { exact: true })).toBeVisible();
  expect(savedBody).toMatchObject({ baseRevision: 44, confirmRemovals: false });
  expect(savedBody?.operations).toEqual(expect.arrayContaining([
    { type: "set-label", language: "en", value: "Updated fixture tablet" },
    { type: "set-label", language: "de", value: "Tontafel" },
  ]));
});

for (const qid of ["Q9000001", "Q9000003"]) {
  test(`authenticated eligible accounts can create a missing transcription for ${qid}`, async ({ page }) => {
    let creationBody: Record<string, unknown> | undefined;
    await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { id: "17", username: "Fixture Editor" } }) }));
    await page.route(`**/api/tablets/${qid}/metadata*`, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity: { id: qid, lastRevision: 12, labels: { en: "Sparse tablet" }, descriptions: {}, aliases: {}, sitelinks: {}, statements: [] }, properties: {} }) }));
    await page.route(`**/api/tablets/${qid}/transcription`, async (route) => {
      creationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ status: qid === "Q9000003" ? "created" : "created_and_linked", title: `D-${qid}`, url: `https://database.factgrid.de/wiki/D-${qid}`, pageRevisionId: 88, entityRevisionId: 13 }) });
    });
    await page.goto(`/tablets/${qid}/edit`);
    await page.getByRole("textbox", { name: "Transliteration source", exact: true }).fill("1. a-na EN");
    await page.getByRole("button", { name: "Create and link on FactGrid" }).click();
    await expect(page.getByText("Creation confirmed", { exact: true })).toBeVisible();
    expect(creationBody).toMatchObject({ text: "1. a-na EN" });
  });
}

test("accepted-unconfirmed transcription creation remains locked until deliberate discard", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { id: "17", username: "Fixture Editor" } }) }));
  await page.route("**/api/tablets/Q9000001/metadata*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity: { id: "Q9000001", lastRevision: 12, labels: { en: "Sparse tablet" }, descriptions: {}, aliases: {}, sitelinks: {}, statements: [] }, properties: {} }) }));
  await page.route("**/api/tablets/Q9000001/transcription", async (route) => {
    writes += 1;
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ saveStatus: "accepted_unconfirmed", message: "FactGrid accepted creation, but confirmation was interrupted." }) });
  });

  await page.goto("/tablets/Q9000001/edit");
  const text = page.getByRole("textbox", { name: "Transliteration source", exact: true });
  await text.fill("1. uncertain creation");
  await page.getByRole("button", { name: "Create and link on FactGrid" }).click();
  await expect(page.getByText("FactGrid accepted creation, but confirmation was interrupted.")).toBeVisible();
  await expect(text).toBeDisabled();
  await expect(page.getByRole("button", { name: "Create and link on FactGrid" })).toBeDisabled();
  await expect(page.locator("#transliteration-draft").getByRole("link", { name: "FactGrid item history" })).toBeVisible();
  expect(writes).toBe(1);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Discard draft" }).click();
  await expect(text).toBeEnabled();
  await expect(text).toHaveValue("");
  expect(writes).toBe(1);
});

test("authenticated policy exposes and saves an existing transcription with an empty restricted list", async ({ page }) => {
  let savedBody: Record<string, unknown> | undefined;
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, contributorPolicy: "authenticated", user: { id: "17", username: "Fixture Editor" } }),
  }));
  await page.route("**/api/tablets/Q9000002/editions/**", async (route) => {
    savedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ revisionId: 302, text: "1. changed line", message: "Saved fixture transcription." }) });
  });

  await page.goto("/tablets/Q9000002");
  const editor = page.locator("section").filter({ has: page.getByRole("heading", { name: "Edit transliteration" }) });
  await expect(page.getByRole("heading", { name: "Edit transliteration" })).toBeVisible();
  await editor.getByRole("textbox", { name: "Transliteration source" }).fill("1. changed line");
  await editor.getByRole("button", { name: "Save to FactGrid" }).click();
  await expect(editor.getByText("Save confirmed", { exact: true })).toBeVisible();
  expect(savedBody).toMatchObject({ baseRevision: 301, text: "1. changed line" });
});

test("accepted-unconfirmed transcription saves remain locked until deliberate reset", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, contributorPolicy: "authenticated", user: { id: "17", username: "Fixture Editor" } }),
  }));
  await page.route("**/api/tablets/Q9000002/editions/**", async (route) => {
    writes += 1;
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ saveStatus: "accepted_unconfirmed", message: "FactGrid accepted the edit, but confirmation was interrupted." }) });
  });

  await page.goto("/tablets/Q9000002");
  const editor = page.locator("section").filter({ has: page.getByRole("heading", { name: "Edit transliteration" }) });
  const text = editor.getByRole("textbox", { name: "Transliteration source" });
  const originalText = await text.inputValue();
  await text.fill("1. uncertain line");
  await editor.getByRole("button", { name: "Save to FactGrid" }).click();
  await expect(editor.getByText("FactGrid accepted the edit, but confirmation was interrupted.")).toBeVisible();
  await expect(text).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Save to FactGrid" })).toBeDisabled();
  await expect(editor.getByRole("link", { name: "FactGrid history" })).toBeVisible();
  expect(writes).toBe(1);

  page.once("dialog", (dialog) => dialog.accept());
  await editor.getByRole("button", { name: "Cancel changes" }).click();
  await expect(text).toBeEnabled();
  await expect(text).toHaveValue(originalText);
  expect(writes).toBe(1);
});

test("accepted-unconfirmed metadata saves preserve a discardable draft and reconciliation link", async ({ page }) => {
  const entity = { id: "Q9000002", lastRevision: 44, labels: { en: "Fixture tablet" }, descriptions: {}, aliases: {}, sitelinks: {}, statements: [] };
  const properties = {};
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { id: "17", username: "Fixture Editor" } }),
  }));
  await page.route("**/api/tablets/Q9000002/metadata*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity, properties }) });
      return;
    }
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ saveStatus: "accepted_unconfirmed", message: "FactGrid accepted the metadata edit, but confirmation was interrupted." }) });
  });

  await page.goto("/tablets/Q9000002/edit");
  await page.getByLabel("Label", { exact: true }).fill("Uncertain tablet");
  await page.getByRole("button", { name: "Review and save" }).click();
  await page.getByRole("button", { name: "Confirm and save" }).click();
  await expect(page.getByText("FactGrid accepted the metadata edit, but confirmation was interrupted.")).toBeVisible();
  await expect(page.getByRole("link", { name: "FactGrid item history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review and save" })).toBeDisabled();
  const discard = page.getByRole("button", { name: "Discard metadata changes" });
  await expect(discard).toBeEnabled();
  await discard.click();
  await expect(page.getByLabel("Label", { exact: true })).toHaveValue("Fixture tablet");
  await expect(page.getByText("Metadata synchronized at revision 44")).toBeVisible();
});

test("restricted policy keeps an unlisted existing transcription read-only", async ({ page }) => {
  let writes = 0;
  await page.route("**/api/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, contributorPolicy: "restricted", user: { id: "17", username: "Fixture Editor" } }),
  }));
  page.on("request", (request) => { if (request.url().includes("/editions/") && request.method() === "PUT") writes += 1; });

  await page.goto("/tablets/Q9000002");
  await expect(page.getByText(/not on this deployment.*approved edit-target list/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Edit transliteration" })).toHaveCount(0);
  expect(writes).toBe(0);
});

test("partial transcription recovery retries the immutable original payload", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { id: "17", username: "Fixture Editor" } }) }));
  await page.route("**/api/tablets/Q9000001/metadata*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity: { id: "Q9000001", lastRevision: 12, labels: { en: "Sparse tablet" }, descriptions: {}, aliases: {}, sitelinks: {}, statements: [] }, properties: {} }) }));
  await page.route("**/api/tablets/Q9000001/transcription", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    if (bodies.length === 1) {
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ saveStatus: "partial", message: "Page created; link pending.", recovery: { title: "D-Q9000001" } }) });
    } else {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ status: "created_and_linked", title: "D-Q9000001" }) });
    }
  });
  await page.goto("/tablets/Q9000001/edit");
  const text = page.getByRole("textbox", { name: "Transliteration source", exact: true });
  await text.fill("original text");
  await page.getByRole("textbox", { name: "Edit summary", exact: true }).last().fill("original summary");
  await page.getByRole("button", { name: "Create and link on FactGrid" }).click();
  await expect(page.getByRole("button", { name: "Finish linking" })).toBeVisible();
  await text.evaluate((element) => element.removeAttribute("disabled"));
  await text.fill("tampered text");
  await page.getByRole("button", { name: "Finish linking" }).click();
  await expect(page.getByText("Creation confirmed", { exact: true })).toBeVisible();
  expect(bodies).toEqual([
    { text: "original text", summary: "original summary" },
    { text: "original text", summary: "original summary" },
  ]);
});

test("draft guard cancels links and logout before mutation, and restores after reload", async ({ page }) => {
  let logoutRequests = 0;
  let signedOut = false;
  let logoutOutcome: "failed" | "unrevoked" = "failed";
  await page.route("**/api/session", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(signedOut ? { authenticated: false } : { authenticated: true, csrfToken: "fixture-csrf", editingEnabled: true, editorApproved: true, user: { id: "17", username: "Fixture Editor" } }) }));
  await page.route("**/api/tablets/Q9000001/metadata*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ entity: { id: "Q9000001", lastRevision: 12, labels: { en: "Sparse tablet" }, descriptions: {}, aliases: {}, sitelinks: {}, statements: [] }, properties: {} }) }));
  await page.route("**/api/auth/logout", (route) => {
    logoutRequests += 1;
    if (logoutOutcome === "failed") return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ signedOut: false, serverSessionRevoked: false, error: { message: "Sign-out request was rejected." } }) });
    signedOut = true;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ signedOut: true, serverSessionRevoked: false, warning: "Browser signed out; server revocation is uncertain." }) });
  });
  await page.goto("/about");
  await page.goto("/tablets/Q9000001/edit");
  const text = page.getByRole("textbox", { name: "Transliteration source", exact: true });
  await text.fill("recover me");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Browse", exact: true }).click();
  await expect(page).toHaveURL(/\/tablets\/Q9000001\/edit$/);
  await expect(text).toHaveValue("recover me");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Sign out" }).click();
  expect(logoutRequests).toBe(0);
  await expect(page.getByLabel("Signed in as Fixture Editor")).toBeVisible();

  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("factgrid:draft:v1:")))).toBe(true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Transliteration source", exact: true })).toHaveValue("recover me");

  page.on("dialog", (dialog) => dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(/\/about$/);
  await page.goForward();
  await expect(page.getByRole("textbox", { name: "Transliteration source", exact: true })).toHaveValue("recover me");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Sign-out request was rejected.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Transliteration source", exact: true })).toHaveValue("recover me");
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("factgrid:draft:v1:")))).toBe(true);
  expect(logoutRequests).toBe(1);

  logoutOutcome = "unrevoked";
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Browser signed out; server revocation is uncertain.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("factgrid:draft:v1:")))).toBe(false);
  expect(logoutRequests).toBe(2);
});
