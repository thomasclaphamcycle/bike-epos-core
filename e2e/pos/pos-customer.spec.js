const { test, expect } = require("@playwright/test");
const {
  addDaysToDateKey,
  apiJson,
  apiJsonWithHeaderBypass,
  ensureUserViaAdminBypass,
  getFirstOpenWorkshopDateKeyViaBypass,
  getLondonDateKey,
  getMondayDateKey,
  getOperationalWeekStartDateKey,
  loginViaUi,
  markWebOrderPackedViaBypass,
  parseDateKeyAtNoon,
  searchInventoryRows,
  searchOnlineStoreOrders,
  seedCatalogVariant,
  seedPosSaleViaBypass,
  uniqueToken,
  frontendBaseUrl,
  toLocalFrontendUrl,
  expandPosCustomerCaptureFallback,
  collectPosAddTwoDiagnostics,
  parseOnHand,
  expectStocktakeLineCount,
  freezeBrowserClock,
  ensureOpenRegisterSession,
  createRotaPeriodViaBypass,
  saveRotaAssignmentViaBypass,
  dragBetweenLocators,
  seedNamedQuickAddProduct,
} = require("../spec_support");

test.describe.configure({ mode: "default" });
test("React POS customer search, attach, change, and checkout preserves final customer linkage", async ({
  page,
  request,
}) => {
  const customerSearchInput = page.getByTestId("pos-customer-search");

  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "react-pos-customer",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "react-pos-customer" });
  const token = uniqueToken("react-pos-customer");
  const firstCustomer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: `React POS First ${token}`,
      email: `react-pos-first-${token}@example.com`,
      phone: "07111111111",
    },
  });
  const secondCustomer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: `React POS Second ${token}`,
      email: `react-pos-second-${token}@example.com`,
      phone: "07222222222",
    },
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });
  await expect(page.getByRole("heading", { name: "POS" })).toBeVisible();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeVisible();
  await expect(customerSearchInput).toBeVisible();

  await customerSearchInput.click();
  await customerSearchInput.fill(firstCustomer.name);
  await expect(customerSearchInput).toHaveValue(firstCustomer.name);
  await expect(page.getByTestId(`pos-customer-select-${firstCustomer.id}`)).toBeVisible();
  await page.getByTestId(`pos-customer-select-${firstCustomer.id}`).click();
  await expect.poll(async () => {
    const chip = page.getByTestId("pos-selected-customer");
    if (await chip.count() === 0) {
      return null;
    }
    return chip.textContent();
  }).toContain(firstCustomer.name);
  await expect.poll(async () => {
    const chip = page.getByTestId("pos-selected-customer");
    if (await chip.count() === 0) {
      return null;
    }
    return chip.textContent();
  }).toContain("Attached to basket");

  await page.getByTestId("pos-product-search").fill(seeded.barcode);
  await page.getByTestId("pos-product-search").press("Enter");
  await expect(page.getByTestId("pos-product-search")).toHaveValue("");
  await expect(page.getByTestId("pos-checkout-basket")).toBeEnabled();

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-selected-customer")).toContainText("Attached to sale");
  await expect(page.getByTestId("pos-customer-capture-attached-state")).toContainText("Customer already attached");
  await expect(page.getByTestId("pos-customer-capture-panel")).toContainText(firstCustomer.email);
  await expect(page.getByTestId("pos-customer-capture-generate")).toHaveCount(0);

  const saleIdAfterCheckout = new URL(page.url()).searchParams.get("saleId");
  expect(saleIdAfterCheckout).toBeTruthy();

  await page.getByTestId("pos-customer-clear").click();
  await expect(page.getByTestId("pos-selected-customer")).toHaveCount(0);
  await expect(customerSearchInput).toBeVisible();

  await customerSearchInput.click();
  await customerSearchInput.fill(secondCustomer.email);
  await expect(customerSearchInput).toHaveValue(secondCustomer.email);
  await expect(page.getByTestId(`pos-customer-select-${secondCustomer.id}`)).toBeVisible();
  await page.getByTestId(`pos-customer-select-${secondCustomer.id}`).click();
  await expect(page.getByTestId("pos-selected-customer")).toContainText(secondCustomer.name);
  await expect(page.getByTestId("pos-selected-customer")).toContainText("Attached to sale");

  await page.getByTestId("pos-complete-sale").click();
  await expect(page.getByText("Sale complete.")).toBeVisible();

  const completedSale = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/sales/${encodeURIComponent(saleIdAfterCheckout)}`,
    "MANAGER",
  );
  expect(completedSale.sale.customer?.id).toBe(secondCustomer.id);
  expect(completedSale.sale.customer?.name).toBe(secondCustomer.name);
});

test("POS customer capture works before checkout and carries the customer into the created sale", async ({
  page,
  request,
  context,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-customer-capture",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "pos-customer-capture" });
  const token = uniqueToken("pos-customer-capture");
  const uniquePhone = `07${token.replace(/\D/g, "").slice(-9).padStart(9, "0")}`;

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await expect(page.getByTestId("pos-customer-capture-panel")).toBeVisible();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();

  await page.getByTestId("pos-customer-capture-generate").click();
  const captureUrlInput = await expandPosCustomerCaptureFallback(page);
  const captureUrl = await captureUrlInput.inputValue();
  expect(captureUrl).toContain("/customer-capture");

  const capturePage = await context.newPage();
  await capturePage.goto(toLocalFrontendUrl(captureUrl));
  await expect(capturePage.getByTestId("customer-capture-form")).toBeVisible();
  await capturePage.getByTestId("customer-capture-first-name").fill("Taylor");
  await capturePage.getByTestId("customer-capture-last-name").fill("Rider");
  await capturePage.getByTestId("customer-capture-email").fill(`capture-${token}@example.com`);
  await capturePage.getByTestId("customer-capture-phone").fill(uniquePhone);
  await capturePage.getByRole("button", { name: "Save details" }).click();
  await expect(capturePage.getByTestId("customer-capture-success")).toContainText("Details saved.");
  await expect(capturePage.getByTestId("customer-capture-success")).toContainText("A new customer profile was created.");

  await expect.poll(async () => {
    const chip = page.getByTestId("pos-selected-customer");
    if (await chip.count() === 0) {
      return null;
    }
    return chip.textContent();
  }).toContain("Taylor Rider");
  await expect(page.getByTestId("pos-customer-capture-attached-state")).toContainText("Customer already attached");

  await page.getByTestId("pos-product-search").fill(seeded.sku);
  await expect(page.getByTestId(`pos-product-add-${seeded.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${seeded.variant.id}`).click();
  await expect(page.getByTestId("pos-checkout-basket")).toBeEnabled();
  await page.getByTestId("pos-checkout-basket").click();

  await expect.poll(() => new URL(page.url()).searchParams.get("saleId")).toBeTruthy();
  const saleId = new URL(page.url()).searchParams.get("saleId");

  await expect(page.getByTestId("pos-customer-capture-attached-state")).toContainText("Customer already attached");
  await expect(page.getByTestId("pos-selected-customer")).toContainText(`capture-${token}@example.com`);

  await page.goto(`${frontendBaseUrl}/pos`);
  await expect(page.getByTestId("pos-customer-capture-success")).toHaveCount(0);
  await expect(page.getByTestId("pos-customer-capture-completed-state")).toHaveCount(0);
  await expect(page.getByTestId("pos-customer-capture-ready-state")).toBeVisible();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();
  await page.goto(`${frontendBaseUrl}/pos?saleId=${encodeURIComponent(saleId)}`);
  await expect(page.getByTestId("pos-selected-customer")).toContainText("Taylor Rider");
  await expect(page.getByTestId("pos-customer-capture-success")).toHaveCount(0);
  await expect(page.getByTestId("pos-customer-capture-attached-state")).toContainText("Customer already attached");

  await capturePage.goto(toLocalFrontendUrl(captureUrl));
  await expect(capturePage.getByText("Details already submitted")).toBeVisible();
  await capturePage.goto(new URL("/customer-capture", frontendBaseUrl).toString());
  await expect(capturePage.getByText("No active customer capture yet")).toBeVisible();

  const refreshedSale = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/sales/${encodeURIComponent(saleId)}`,
    "MANAGER",
  );
  expect(refreshedSale.sale.customer?.email).toBe(`capture-${token}@example.com`);
});

test("POS customer capture regeneration makes older public links fail clearly", async ({
  page,
  request,
  context,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-customer-capture-replaced",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "pos-customer-capture-replaced" });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await page.getByTestId("pos-product-search").fill(seeded.sku);
  await expect(page.getByTestId(`pos-product-add-${seeded.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${seeded.variant.id}`).click();
  await expect(page.getByTestId("pos-checkout-basket")).toBeEnabled();

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();
  await page.getByTestId("pos-customer-capture-generate").click();

  const firstCaptureUrl = await (await expandPosCustomerCaptureFallback(page)).inputValue();
  await expect(firstCaptureUrl).toContain("/customer-capture");
  const saleId = new URL(page.url()).searchParams.get("saleId");
  expect(saleId).toBeTruthy();

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/sales/${encodeURIComponent(saleId)}/customer-capture-sessions`,
    "MANAGER",
    {},
  );

  await page.getByTestId("pos-customer-capture-refresh").click();
  const captureUrlInput = await expandPosCustomerCaptureFallback(page);
  await expect.poll(async () => captureUrlInput.inputValue()).not.toBe(firstCaptureUrl);
  const secondCaptureUrl = await captureUrlInput.inputValue();
  expect(secondCaptureUrl).toContain("/customer-capture");
  expect(secondCaptureUrl).not.toBe(firstCaptureUrl);

  const firstCapturePage = await context.newPage();
  await firstCapturePage.goto(toLocalFrontendUrl(firstCaptureUrl));
  await expect(firstCapturePage.getByText("Link replaced")).toBeVisible();

  const secondCapturePage = await context.newPage();
  await secondCapturePage.goto(toLocalFrontendUrl(secondCaptureUrl));
  await expect(secondCapturePage.getByTestId("customer-capture-form")).toBeVisible();
});

test("POS customer capture panel resets to ready after removing a captured basket customer", async ({
  page,
  request,
  context,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-capture-reset-after-detach",
  });
  const token = uniqueToken("pos-capture-reset-after-detach");
  const uniquePhone = `07${token.replace(/\D/g, "").slice(-9).padStart(9, "0")}`;

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();
  await page.getByTestId("pos-customer-capture-generate").click();

  const captureUrl = await (await expandPosCustomerCaptureFallback(page)).inputValue();
  await expect(captureUrl).toContain("/customer-capture");

  const capturePage = await context.newPage();
  await capturePage.goto(toLocalFrontendUrl(captureUrl));
  await expect(capturePage.getByTestId("customer-capture-form")).toBeVisible();
  await capturePage.getByTestId("customer-capture-first-name").fill("Reset");
  await capturePage.getByTestId("customer-capture-last-name").fill("Rider");
  await capturePage.getByTestId("customer-capture-email").fill(`reset-capture-${token}@example.com`);
  await capturePage.getByTestId("customer-capture-phone").fill(uniquePhone);
  await capturePage.getByRole("button", { name: "Save details" }).click();
  await expect(capturePage.getByTestId("customer-capture-success")).toContainText("Details saved.");

  await expect.poll(async () => {
    const chip = page.getByTestId("pos-selected-customer");
    if (await chip.count() === 0) {
      return null;
    }
    return chip.textContent();
  }).toContain("Reset Rider");

  await expect(page.getByTestId("pos-customer-capture-attached-state")).toContainText("Customer already attached");
  await page.getByTestId("pos-customer-clear").click();

  await expect(page.getByTestId("pos-selected-customer")).toHaveCount(0);
  await expect(page.getByText("No customer attached yet. This basket stays as walk-in until you add one.")).toBeVisible();
  await expect(page.locator(".pos-payment-summary")).toContainText("Walk-in");
  await expect(page.getByTestId("pos-customer-capture-success")).toHaveCount(0);
  await expect(page.getByTestId("pos-customer-capture-completed-state")).toHaveCount(0);
  await expect(page.getByTestId("pos-customer-capture-ready-state")).toBeVisible();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();
  await expect(page.getByTestId("pos-customer-capture-panel")).not.toContainText("Customer details received");
  await expect(page.getByTestId("pos-customer-capture-panel")).not.toContainText("New customer");
  await expect(page.getByTestId("pos-customer-capture-panel")).not.toContainText("Created a new customer profile for");

  await page.getByTestId("pos-customer-capture-generate").click();
  await expect(page.getByTestId("pos-customer-capture-live-state")).toBeVisible();
  await expect(await expandPosCustomerCaptureFallback(page)).toHaveValue(/customer-capture\?token=/);
});

test("POS customer capture is actionable on a fresh basket before any products are added", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-customer-capture-no-sale",
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await expect(page.getByTestId("pos-customer-capture-ready-state")).toBeVisible();
  await expect(page.getByTestId("pos-customer-capture-ready-title")).toHaveText("Ready");
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();
});

test("POS customer capture reloads the correct active session after switching sales", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-customer-capture-switch",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "pos-customer-capture-switch" });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await page.getByTestId("pos-product-search").fill(seeded.sku);
  await expect(page.getByTestId(`pos-product-add-${seeded.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${seeded.variant.id}`).click();
  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();
  await page.getByTestId("pos-customer-capture-generate").click();

  const captureUrl = await (await expandPosCustomerCaptureFallback(page)).inputValue();
  const saleId = new URL(page.url()).searchParams.get("saleId");
  expect(saleId).toBeTruthy();

  await page.goto(`${frontendBaseUrl}/pos`);
  await expect(page.getByTestId("pos-customer-capture-url")).toHaveCount(0);

  await page.goto(`${frontendBaseUrl}/pos?saleId=${encodeURIComponent(saleId)}`);
  await expect(page.getByTestId("pos-customer-capture-live-state")).toBeVisible();
  await expect(page.getByTestId("pos-customer-capture-refresh")).toBeVisible();
  await expect(await expandPosCustomerCaptureFallback(page)).toHaveValue(captureUrl);
  await expect(page.getByTestId("pos-customer-capture-time-left")).toBeVisible();
});

test("POS customer capture shows matched-by-email outcome for existing customers", async ({
  page,
  request,
  context,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-customer-capture-match-email",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "pos-customer-capture-match-email" });
  const token = uniqueToken("pos-customer-capture-match-email");
  const existingCustomer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      firstName: "Morgan",
      lastName: "Existing",
      email: `matched-${token}@example.com`,
      phone: `07${token.replace(/\D/g, "").slice(-9).padStart(9, "1")}`,
    },
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await page.getByTestId("pos-product-search").fill(seeded.sku);
  await expect(page.getByTestId(`pos-product-add-${seeded.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${seeded.variant.id}`).click();
  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();
  await page.getByTestId("pos-customer-capture-generate").click();

  const captureUrl = await (await expandPosCustomerCaptureFallback(page)).inputValue();
  const capturePage = await context.newPage();
  await capturePage.goto(toLocalFrontendUrl(captureUrl));
  await expect(capturePage.getByTestId("customer-capture-form")).toBeVisible();
  await capturePage.getByTestId("customer-capture-first-name").fill("Morgan");
  await capturePage.getByTestId("customer-capture-last-name").fill("Existing");
  await capturePage.getByTestId("customer-capture-email").fill(existingCustomer.email);
  await capturePage.getByTestId("customer-capture-phone").fill("07000000000");
  await capturePage.getByRole("button", { name: "Save details" }).click();
  await expect(capturePage.getByTestId("customer-capture-success")).toContainText("matched an existing customer by email");

  await expect.poll(async () => {
    const chip = page.getByTestId("pos-selected-customer");
    if (await chip.count() === 0) {
      return null;
    }
    return chip.textContent();
  }).toContain("Morgan Existing");

  await expect(page.getByTestId("pos-customer-capture-success")).toContainText("Matched by email");
  await expect(page.getByTestId("pos-customer-capture-success")).toContainText("Matched existing customer Morgan Existing by email.");
  await expect(page.getByTestId("pos-customer-capture-success")).toContainText(existingCustomer.email);
});

test("POS customer capture shows matched-by-phone outcome for existing customers", async ({
  page,
  request,
  context,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-customer-capture-match-phone",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "pos-customer-capture-match-phone" });
  const token = uniqueToken("pos-customer-capture-match-phone");
  const existingPhone = `07${token.replace(/\D/g, "").slice(-9).padStart(9, "2")}`;
  const existingCustomer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: `Jamie Phone ${token}`,
      phone: existingPhone,
    },
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await page.getByTestId("pos-product-search").fill(seeded.sku);
  await expect(page.getByTestId(`pos-product-add-${seeded.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${seeded.variant.id}`).click();
  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();
  await page.getByTestId("pos-customer-capture-generate").click();

  const captureUrl = await (await expandPosCustomerCaptureFallback(page)).inputValue();
  const capturePage = await context.newPage();
  await capturePage.goto(toLocalFrontendUrl(captureUrl));
  await expect(capturePage.getByTestId("customer-capture-form")).toBeVisible();
  await capturePage.getByTestId("customer-capture-first-name").fill("Jamie");
  await capturePage.getByTestId("customer-capture-last-name").fill("Phone");
  await capturePage.getByTestId("customer-capture-email").fill(`fresh-${token}@example.com`);
  await capturePage.getByTestId("customer-capture-phone").fill(existingPhone);
  await capturePage.getByRole("button", { name: "Save details" }).click();
  await expect(capturePage.getByTestId("customer-capture-success")).toContainText("matched an existing customer by phone");

  await expect.poll(async () => {
    const chip = page.getByTestId("pos-selected-customer");
    if (await chip.count() === 0) {
      return null;
    }
    return chip.textContent();
  }).toContain(existingCustomer.name);

  await expect(page.getByTestId("pos-customer-capture-success")).toContainText("Matched by phone");
  await expect(page.getByTestId("pos-customer-capture-success")).toContainText(`Matched existing customer ${existingCustomer.name} by phone.`);
  await expect(page.getByTestId("pos-customer-capture-success")).toContainText(existingPhone);
});
