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
test("Login then POS page loads and can search products", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-login-search",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "pos-search" });

  await loginViaUi(page, credentials, "/pos");
  await page.fill("#search-q", seeded.sku);
  await page.click("#search-load");

  await expect(page.locator("#search-status")).toContainText("Loaded");
  await expect(page.locator("#search-table-wrap")).toContainText(seeded.sku);
});

test("React POS product search supports keyboard navigation and quick add quantity 2", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "react-pos-product-keyboard",
  });
  const sharedPrefix = uniqueToken("react-pos-product-keyboard");
  const firstProduct = await seedCatalogVariant(request, {
    prefix: `${sharedPrefix}-one`,
    retailPricePence: 1499,
  });
  const secondProduct = await seedCatalogVariant(request, {
    prefix: `${sharedPrefix}-two`,
    retailPricePence: 2399,
  });
  const clickProduct = await seedCatalogVariant(request, {
    prefix: `${sharedPrefix}-three`,
    retailPricePence: 1899,
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  const productSearchInput = page.getByTestId("pos-product-search");
  await productSearchInput.fill(sharedPrefix);

  const resultRows = page.locator(".pos-results-wrap tbody tr");
  await expect(resultRows).toHaveCount(3);
  await expect(resultRows.nth(0)).toHaveClass(/pos-search-result-active/);

  const firstRowSku = (await resultRows.nth(0).locator("td").nth(1).textContent())?.trim();
  const secondRowSku = (await resultRows.nth(1).locator("td").nth(1).textContent())?.trim();
  expect(firstRowSku).toBeTruthy();
  expect(secondRowSku).toBeTruthy();

  await productSearchInput.press("ArrowDown");
  await expect(resultRows.nth(1)).toHaveClass(/pos-search-result-active/);
  await productSearchInput.press("Enter");
  await expect(productSearchInput).toHaveValue("");
  await expect(productSearchInput).toBeFocused();

  const basketId = new URL(page.url()).searchParams.get("basketId");
  expect(basketId).toBeTruthy();
  const keyboardSelectedSku = secondRowSku;

  await expect.poll(async () => {
    const basketAfterKeyboardAdd = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/baskets/${encodeURIComponent(basketId)}`,
      "MANAGER",
    );
    return basketAfterKeyboardAdd.items.find((item) => item.sku === keyboardSelectedSku)?.quantity ?? 0;
  }).toBe(1);

  await productSearchInput.fill(firstProduct.sku);
  const addTwoButton = page.locator(`tr:has([data-testid="pos-product-add-${firstProduct.variant.id}"])`).getByRole("button", {
    name: "Add 2",
  });
  await expect(addTwoButton).toBeVisible();
  const addTwoDiagnosticsBeforeClick = await collectPosAddTwoDiagnostics(page, firstProduct.variant.id);
  await test.info().attach("pos-add-two-before-click", {
    body: JSON.stringify(addTwoDiagnosticsBeforeClick, null, 2),
    contentType: "application/json",
  });

  try {
    await addTwoButton.click();
  } catch (error) {
    const addTwoDiagnosticsAfterFailure = await collectPosAddTwoDiagnostics(page, firstProduct.variant.id);
    await test.info().attach("pos-add-two-click-failure", {
      body: JSON.stringify(addTwoDiagnosticsAfterFailure, null, 2),
      contentType: "application/json",
    });
    throw error;
  }

  await expect(productSearchInput).toBeFocused();
  const expectedFirstProductQuantity = keyboardSelectedSku === firstProduct.sku ? 3 : 2;

  await expect.poll(async () => {
    const basketAfterQuickAdd = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/baskets/${encodeURIComponent(basketId)}`,
      "MANAGER",
    );
    return basketAfterQuickAdd.items.find((item) => item.sku === firstProduct.sku)?.quantity ?? 0;
  }).toBe(expectedFirstProductQuantity);

  await productSearchInput.fill(secondProduct.sku);
  await productSearchInput.press("Shift+Enter");
  await expect(productSearchInput).toHaveValue("");
  await expect(productSearchInput).toBeFocused();
  const expectedSecondProductQuantity = keyboardSelectedSku === secondProduct.sku ? 3 : 2;

  await expect.poll(async () => {
    const basketAfterShiftEnter = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/baskets/${encodeURIComponent(basketId)}`,
      "MANAGER",
    );
    return {
      firstProductQuantity: basketAfterShiftEnter.items.find((item) => item.sku === firstProduct.sku)?.quantity ?? 0,
      secondProductQuantity: basketAfterShiftEnter.items.find((item) => item.sku === secondProduct.sku)?.quantity ?? 0,
    };
  }).toEqual({
    firstProductQuantity: expectedFirstProductQuantity,
    secondProductQuantity: expectedSecondProductQuantity,
  });

  await productSearchInput.fill(clickProduct.sku);
  const clickRow = page.locator(`tr:has([data-testid="pos-product-add-${clickProduct.variant.id}"])`);
  await expect(clickRow).toBeVisible();
  await clickRow.locator("td").first().click();
  await expect(productSearchInput).toBeFocused();

  await expect.poll(async () => {
    const basketAfterRowClick = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/baskets/${encodeURIComponent(basketId)}`,
      "MANAGER",
    );
    return basketAfterRowClick.items.find((item) => item.sku === clickProduct.sku)?.quantity ?? 0;
  }).toBe(1);
});

test("React POS quick add grid renders shortcuts and adds products instantly", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "react-pos-quick-add",
  });
  const innerTube = await seedNamedQuickAddProduct(request, {
    slug: "tube",
    name: "Inner Tube",
    retailPricePence: 699,
  });
  await seedNamedQuickAddProduct(request, {
    slug: "lube",
    name: "Chain Lube",
    retailPricePence: 899,
  });
  await seedNamedQuickAddProduct(request, {
    slug: "pads",
    name: "Brake Pads",
    retailPricePence: 1499,
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await expect(page.getByTestId("pos-quick-add-grid")).toBeVisible();
  await expect(page.getByTestId("pos-quick-add-inner-tube")).toContainText("Inner Tube");
  await expect(page.getByTestId("pos-quick-add-chain-lube")).toContainText("Chain Lube");
  await expect(page.getByTestId("pos-quick-add-brake-pads")).toContainText("Brake Pads");

  await page.getByTestId("pos-quick-add-inner-tube").click();
  await expect(page.getByTestId("pos-product-search")).toBeFocused();

  const basketId = new URL(page.url()).searchParams.get("basketId");
  expect(basketId).toBeTruthy();

  await expect.poll(async () => {
    const basket = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/baskets/${encodeURIComponent(basketId)}`,
      "MANAGER",
    );
    return basket.items.find((item) => item.variantId === innerTube.variant.id)?.quantity ?? 0;
  }).toBe(1);

  await expect(page.locator(".pos-line-item", { hasText: "Inner Tube" })).toHaveClass(/pos-line-item-highlighted/);
});

test("React POS restores the active basket across navigation and clears stored basket state on checkout", async ({
  page,
  request,
}) => {
  const activeBasketStorageKey = "corepos_active_basket_id";
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "react-pos-basket-persistence",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "react-pos-basket-persistence" });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await page.getByTestId("pos-product-search").fill(seeded.sku);
  await expect(page.getByTestId(`pos-product-add-${seeded.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${seeded.variant.id}`).click();

  const initialBasketId = new URL(page.url()).searchParams.get("basketId");
  expect(initialBasketId).toBeTruthy();

  await expect.poll(async () => page.evaluate(
    (storageKey) => window.localStorage.getItem(storageKey),
    activeBasketStorageKey,
  )).toBe(initialBasketId);

  await page.goto(`${frontendBaseUrl}/customers`);
  await expect(page).toHaveURL(/\/customers/);

  await page.goto(`${frontendBaseUrl}/pos`);
  await expect.poll(() => new URL(page.url()).searchParams.get("basketId")).toBe(initialBasketId);
  await expect(page.getByTestId("pos-checkout-basket")).toBeEnabled();

  await expect.poll(async () => {
    const restoredBasket = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/baskets/${encodeURIComponent(initialBasketId)}`,
      "MANAGER",
    );
    return restoredBasket.items.find((item) => item.sku === seeded.sku)?.quantity ?? 0;
  }).toBe(1);

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-complete-sale")).toBeVisible();

  await expect.poll(async () => page.evaluate(
    (storageKey) => window.localStorage.getItem(storageKey),
    activeBasketStorageKey,
  )).toBeNull();
});

test("React POS delayed stored-basket restore cannot pull navigation back to stale POS state", async ({
  page,
  request,
}) => {
  const activeBasketStorageKey = "corepos_active_basket_id";
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "react-pos-delayed-restore",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "react-pos-delayed-restore" });
  const seededBasket = await apiJsonWithHeaderBypass(request, "POST", "/api/baskets", "MANAGER");

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/baskets/${encodeURIComponent(seededBasket.id)}/items`,
    "MANAGER",
    {
      data: {
        variantId: seeded.variant.id,
        quantity: 1,
      },
    },
  );

  let delayedBasketLoads = 0;
  await page.route(`**/api/baskets/${encodeURIComponent(seededBasket.id)}`, async (route) => {
    if (route.request().method() !== "GET" || delayedBasketLoads > 0) {
      await route.continue();
      return;
    }

    delayedBasketLoads += 1;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/customers", { surface: "frontend" });
  await page.evaluate(([storageKey, basketId]) => {
    window.localStorage.setItem(storageKey, basketId);
  }, [activeBasketStorageKey, seededBasket.id]);

  await page.goto(`${frontendBaseUrl}/pos`);
  await expect.poll(() => delayedBasketLoads).toBe(1);

  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  await primaryNav.getByRole("link", { name: "Receipts", exact: true }).click();
  await expect(page).toHaveURL(/\/sales-history\/receipt-view/);

  await page.waitForTimeout(1800);
  await expect(page).toHaveURL(/\/sales-history\/receipt-view/);
});

test("React POS replaces stale stored basket ids with a fresh basket on load", async ({
  page,
  request,
}) => {
  const activeBasketStorageKey = "corepos_active_basket_id";
  const staleBasketId = "00000000-0000-0000-0000-000000000000";
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "react-pos-stale-basket",
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });

  await page.goto(`${frontendBaseUrl}/customers`);
  await expect(page).toHaveURL(/\/customers/);

  await page.evaluate(([storageKey, nextBasketId]) => {
    window.localStorage.setItem(storageKey, nextBasketId);
  }, [activeBasketStorageKey, staleBasketId]);

  await page.goto(`${frontendBaseUrl}/pos`);
  await expect.poll(async () => {
    const storedBasketId = await page.evaluate(
      (storageKey) => window.localStorage.getItem(storageKey),
      activeBasketStorageKey,
    );
    return Boolean(storedBasketId) && storedBasketId !== staleBasketId;
  }).toBe(true);

  const finalRecoveredBasketId = await page.evaluate(
    (storageKey) => window.localStorage.getItem(storageKey),
    activeBasketStorageKey,
  );
  expect(finalRecoveredBasketId).toBeTruthy();
  expect(finalRecoveredBasketId).not.toBe(staleBasketId);

  const recoveredBasketId = finalRecoveredBasketId;

  await expect(page.getByTestId("pos-checkout-basket")).toBeDisabled();
  await expect(page.locator(".pos-basket-panel")).toContainText("Scan or search to start");
  await expect.poll(async () => {
    const recoveredBasket = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/baskets/${encodeURIComponent(recoveredBasketId)}`,
      "MANAGER",
    );
    return recoveredBasket.items.length;
  }).toBe(0);
});
