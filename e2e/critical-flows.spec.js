const { test, expect } = require("@playwright/test");
const {
  apiJson,
  apiJsonWithHeaderBypass,
  ensureUserViaAdminBypass,
  loginViaUi,
  seedCatalogVariant,
  uniqueToken,
} = require("./helpers");

const frontendBaseUrl = process.env.REACT_FRONTEND_BASE_URL || "http://localhost:4173";

const collectPosAddTwoDiagnostics = async (page, variantId) => page.evaluate((buttonTestId) => {
  const serializeElement = (selector) => {
    const element = document.querySelector(selector);
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return {
      selector,
      tagName: element.tagName,
      className: element.className,
      text: element.textContent?.trim().slice(0, 200) ?? "",
      rect: {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      computedStyle: {
        position: style.position,
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
        display: style.display,
        overflow: style.overflow,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      },
    };
  };

  const addButtonSelector = `[data-testid="${buttonTestId}"]`;
  const addButton = document.querySelector(addButtonSelector);
  let elementAtButtonCenter = null;

  if (addButton) {
    const rect = addButton.getBoundingClientRect();
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const topElement = document.elementFromPoint(centerX, centerY);
    const topStyle = topElement ? window.getComputedStyle(topElement) : null;

    elementAtButtonCenter = topElement ? {
      tagName: topElement.tagName,
      className: topElement.className,
      testId: topElement.getAttribute("data-testid"),
      text: topElement.textContent?.trim().slice(0, 200) ?? "",
      computedStyle: topStyle ? {
        position: topStyle.position,
        zIndex: topStyle.zIndex,
        pointerEvents: topStyle.pointerEvents,
      } : null,
    } : null;
  }

  return {
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    elements: {
      posLayout: serializeElement(".pos-layout"),
      posMainColumn: serializeElement(".pos-main-column"),
      posSideColumn: serializeElement(".pos-side-column"),
      posSearchPanel: serializeElement(".pos-search-panel"),
      posResultsWrap: serializeElement(".pos-results-wrap"),
      posSearchField: serializeElement(".pos-search-field"),
      addTwoButton: serializeElement(addButtonSelector),
    },
    elementAtButtonCenter,
  };
}, `pos-product-add-${variantId}`);

const parseOnHand = (labelText) => {
  const match = labelText.match(/On hand:\s*(-?\d+)/i);
  if (!match) {
    throw new Error(`Could not parse on-hand from "${labelText}"`);
  }
  return Number.parseInt(match[1], 10);
};

const expectStocktakeLineCount = async (page, variantId, expectedCount) => {
  await expect.poll(async () => {
    const cell = page.getByTestId(`stocktake-line-count-${variantId}`);
    if (await cell.count() === 0) {
      return null;
    }
    return (await cell.first().textContent())?.trim() ?? null;
  }, {
    message: `Expected stocktake line ${variantId} count to become ${expectedCount}`,
  }).toBe(String(expectedCount));
};

const getLondonDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
};

const freezeBrowserClock = async (page, isoValue) => {
  await page.addInitScript(({ isoValue: fixedIso }) => {
    const fixedTime = new Date(fixedIso).getTime();
    const RealDate = Date;

    class FrozenDate extends RealDate {
      constructor(...args) {
        super(...(args.length === 0 ? [fixedTime] : args));
      }

      static now() {
        return fixedTime;
      }
    }

    Object.defineProperty(FrozenDate, "parse", {
      value: RealDate.parse,
    });
    Object.defineProperty(FrozenDate, "UTC", {
      value: RealDate.UTC,
    });

    window.Date = FrozenDate;
    globalThis.Date = FrozenDate;
  }, { isoValue });
};

const parseDateKeyAtNoon = (dateKey) => new Date(`${dateKey}T12:00:00`);

const addDaysToDateKey = (dateKey, days) => {
  const next = parseDateKeyAtNoon(dateKey);
  next.setDate(next.getDate() + days);
  return getLondonDateKey(next);
};

const getOperationalWeekStartDateKey = (anchorDateKey) => {
  const anchor = parseDateKeyAtNoon(anchorDateKey);
  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = parseDateKeyAtNoon(anchorDateKey);
  monday.setDate(monday.getDate() + mondayOffset);
  const weekdayIndex = (day + 6) % 7;
  if (weekdayIndex <= 2) {
    return getLondonDateKey(monday);
  }
  return addDaysToDateKey(anchorDateKey, -2);
};

const ensureOpenRegisterSession = async (request) => {
  const current = await apiJsonWithHeaderBypass(
    request,
    "GET",
    "/api/management/cash/register/current",
    "MANAGER",
  );
  if (current?.session?.id) {
    return current;
  }

  return apiJsonWithHeaderBypass(
    request,
    "POST",
    "/api/management/cash/register/open",
    "MANAGER",
    {
      data: { openingFloatPence: 0 },
    },
  );
};

const createRotaPeriodViaBypass = async (request, startsOn, label) => {
  return apiJsonWithHeaderBypass(request, "POST", "/api/rota/periods", "MANAGER", {
    data: {
      startsOn,
      label,
    },
  });
};

const saveRotaAssignmentViaBypass = async (request, input) => {
  return apiJsonWithHeaderBypass(request, "POST", "/api/rota/assignments", "MANAGER", {
    data: input,
  });
};

const dragBetweenLocators = async (page, source, target) => {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error("Expected both drag endpoints to be visible.");
  }

  await page.mouse.move(sourceBox.x + (sourceBox.width / 2), sourceBox.y + (sourceBox.height / 2));
  await page.mouse.down();
  await page.mouse.move(targetBox.x + (targetBox.width / 2), targetBox.y + (targetBox.height / 2), {
    steps: 12,
  });
  await page.mouse.up();
};

const seedNamedQuickAddProduct = async (request, options) => {
  const token = uniqueToken(`quick-add-${options.slug}`);
  const safeToken = token.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const product = await apiJsonWithHeaderBypass(request, "POST", "/api/products", "MANAGER", {
    data: {
      name: options.name,
      brand: "Quick Add",
      description: `${options.name} quick add seed`,
    },
  });

  const variant = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/products/${encodeURIComponent(product.id)}/variants`,
    "MANAGER",
    {
      data: {
        sku: `QA-${options.slug}-${safeToken}`,
        barcode: `QA-BC-${options.slug}-${safeToken}`,
        name: options.name,
        retailPricePence: options.retailPricePence,
      },
    },
  );

  await apiJsonWithHeaderBypass(request, "POST", "/api/inventory/adjustments", "MANAGER", {
    data: {
      variantId: variant.id,
      quantityDelta: options.initialOnHand ?? 6,
      reason: "COUNT_CORRECTION",
      note: `Quick add seed ${token}`,
    },
  });

  return { product, variant };
};

test.describe.configure({ mode: "serial" });

test("PIN login hides users without a PIN and keeps PIN entry disabled until a PIN user is selected", async ({
  page,
  request,
}) => {
  const reactFrontendUrl = process.env.REACT_FRONTEND_BASE_URL || "http://localhost:4173";
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "pinless-login",
    withPin: false,
  });

  await page.goto(`${reactFrontendUrl}/login`);
  await expect(page.getByTestId(`login-user-${credentials.user.id}`)).toHaveCount(0);
  await expect(page.getByTestId("login-pin")).toBeDisabled();
});

test("Auth routing redirects and navigation visibility follows role", async ({ page, request }) => {
  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });
  const posToggle = page.getByTestId("nav-toggle-pos");
  const reportsToggle = page.getByTestId("nav-toggle-reports");

  await page.context().clearCookies();
  await page.goto("/workshop");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkshop/);

  const staffCredentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "nav-staff",
  });
  await loginViaUi(page, staffCredentials, "/pos", { surface: "frontend" });
  await expect(primaryNav.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Sales History", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Sale", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Receipts", exact: true })).toBeVisible();
  await posToggle.click();
  await expect(primaryNav.getByRole("link", { name: "Receipts", exact: true })).toHaveCount(0);
  await posToggle.click();
  await expect(primaryNav.getByRole("link", { name: "Receipts", exact: true })).toBeVisible();
  await primaryNav.getByRole("link", { name: "Receipts", exact: true }).click();
  await expect(page).toHaveURL(/\/sales-history\/receipt-view/);
  await expect(primaryNav.getByRole("link", { name: "Cash Management", exact: true })).toHaveCount(0);
  await expect(primaryNav.getByRole("link", { name: "Reports", exact: true })).toHaveCount(0);
  await expect(primaryNav.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await page.goto("/workshop");
  await expect(page).toHaveURL(/\/workshop/);
  await page.goto(`${frontendBaseUrl}/home`);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(primaryNav).toBeVisible();

  const managerCredentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "nav-manager",
  });
  await page.context().clearCookies();
  await loginViaUi(page, managerCredentials, null, {
    surface: "frontend",
    expectedPath: "/dashboard",
  });
  await expect(primaryNav.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Sales History", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Cash Management", exact: true })).toHaveCount(0);
  await posToggle.click();
  await expect(primaryNav.getByRole("link", { name: "Cash Management", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Reports", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Financial Reports", exact: true })).toHaveCount(0);
  await reportsToggle.click();
  await expect(primaryNav.getByRole("link", { name: "Cash Management", exact: true })).toHaveCount(0);
  await expect(primaryNav.getByRole("link", { name: "Financial Reports", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await page.goto("/management/cash");
  await expect(page).toHaveURL(/\/management\/cash/);

  const adminCredentials = await ensureUserViaAdminBypass(request, {
    role: "ADMIN",
    prefix: "nav-admin",
  });
  await page.context().clearCookies();
  await loginViaUi(page, adminCredentials, null, {
    surface: "frontend",
    expectedPath: "/dashboard",
  });
  await expect(primaryNav.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Reports", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await page.goto("/management/staff");
  await expect(page).toHaveURL(/\/management\/staff/);
});

test("Login page stays PIN-only and hides users without a PIN", async ({ page, request }) => {
  const passwordOnlyCredentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "password-fallback",
    withPin: false,
  });
  const passwordOnlyButton = page.getByTestId(`login-user-${passwordOnlyCredentials.user.id}`);

  await page.goto(`${frontendBaseUrl}/login`);
  await expect(passwordOnlyButton).toHaveCount(0);
  await expect(page.getByText("Password fallback")).toHaveCount(0);
  await expect(page.getByTestId("login-password-email")).toHaveCount(0);
  await expect(page.getByTestId("login-password-value")).toHaveCount(0);
  await expect(page.getByTestId("login-password-submit")).toHaveCount(0);
  await expect(page.getByTestId("login-pin")).toBeDisabled();
});

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

test("Login then POS add to basket, checkout cash, and open receipt page", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-login-checkout",
  });
  const seeded = await seedCatalogVariant(request, { prefix: "pos-checkout" });
  await ensureOpenRegisterSession(request);

  await loginViaUi(page, credentials, "/pos");
  await page.fill("#search-q", seeded.sku);
  await page.click("#search-load");
  await expect(page.locator("#search-status")).toContainText("Loaded");

  await page.click(".quick-add-1");
  await expect(page.locator("#basket-status")).toContainText("Item added.");

  await page.click("#pay-cash-btn");
  await expect(page.locator("#checkout-status")).toContainText("Cash intent captured");

  const receiptPanel = page.locator("#sale-receipt");
  await expect(receiptPanel).toContainText("Sale ID:");
  const receiptLink = page.getByTestId("view-receipt-link");
  await expect(receiptLink).toHaveCount(1);

  const href = await receiptLink.first().getAttribute("href");
  if (!href) {
    throw new Error("Receipt link href was empty");
  }

  const receiptPanelText = await receiptPanel.innerText();
  const saleIdMatch = receiptPanelText.match(/Sale ID:\s*([0-9a-f-]{36})/i);
  if (!saleIdMatch) {
    throw new Error(`Could not parse sale id from receipt panel: ${receiptPanelText}`);
  }
  const saleId = saleIdMatch[1];

  const issuedReceipt = await apiJson(page.request, "POST", "/api/receipts/issue", {
    data: { saleId },
  });
  const receiptNumber = issuedReceipt?.receipt?.receiptNumber;
  expect(receiptNumber).toBeTruthy();

  await page.goto(href);
  await expect(page.locator("body")).toContainText("Receipt:");
  await expect(page.locator("body")).toContainText(seeded.sku);
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();

  await page.goto(`/r/${encodeURIComponent(receiptNumber)}`);
  await expect(page.locator("body")).toContainText(receiptNumber);
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
});

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
  await expect(customerSearchInput).toBeVisible();

  await customerSearchInput.click();
  await customerSearchInput.fill(firstCustomer.name);
  await expect(customerSearchInput).toHaveValue(firstCustomer.name);
  await expect(page.getByTestId(`pos-customer-select-${firstCustomer.id}`)).toBeVisible();
  await page.getByTestId(`pos-customer-select-${firstCustomer.id}`).click();
  await expect(page.getByTestId("pos-selected-customer")).toContainText(firstCustomer.name);
  await expect(page.getByTestId("pos-selected-customer")).toContainText("Selected for checkout");

  await page.getByTestId("pos-product-search").fill(seeded.barcode);
  await page.getByTestId("pos-product-search").press("Enter");
  await expect(page.getByTestId("pos-product-search")).toHaveValue("");
  await expect(page.getByTestId("pos-checkout-basket")).toBeEnabled();

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-selected-customer")).toContainText("Attached to sale");

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

test("React POS checkout opens a printable thermal receipt page", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "react-pos-receipt-print",
  });
  const firstVariant = await seedCatalogVariant(request, {
    prefix: "react-pos-receipt-print-one",
    retailPricePence: 1299,
  });
  const secondVariant = await seedCatalogVariant(request, {
    prefix: "react-pos-receipt-print-two",
    retailPricePence: 2599,
  });
  await ensureOpenRegisterSession(request);

  await loginViaUi(page, credentials, "/pos", { surface: "frontend" });
  await expect(page.getByRole("heading", { name: "POS" })).toBeVisible();

  await page.getByTestId("pos-product-search").fill(firstVariant.product.name);
  await expect(page.getByTestId(`pos-product-add-${firstVariant.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${firstVariant.variant.id}`).click();
  await expect(page.getByTestId("pos-product-search")).toHaveValue("");

  await page.getByTestId("pos-product-search").fill(secondVariant.product.name);
  await expect(page.getByTestId(`pos-product-add-${secondVariant.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${secondVariant.variant.id}`).click();
  await expect(page.getByTestId("pos-product-search")).toHaveValue("");

  await page.getByTestId("pos-checkout-basket").click();
  await page.getByTestId("pos-complete-sale").click();
  await expect(page.getByText("Sale complete.")).toBeVisible();

  const printReceiptLink = page.getByTestId("pos-print-receipt-link");
  await expect(printReceiptLink).toBeVisible();
  const printReceiptHref = await printReceiptLink.getAttribute("href");
  expect(printReceiptHref).toBeTruthy();

  await page.goto(`${frontendBaseUrl}${printReceiptHref}`);
  await expect(page.getByTestId("sales-receipt")).toBeVisible();
  await expect(page.getByTestId("sales-receipt")).toContainText(firstVariant.product.name);
  await expect(page.getByTestId("sales-receipt")).toContainText(secondVariant.product.name);
  await expect(page.getByRole("button", { name: "Print receipt" })).toBeVisible();
  await expect(page.locator(".app-sidebar")).toHaveCount(0);

  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sales-receipt-print-page__actions")).toBeHidden();
  await expect(page.getByTestId("sales-receipt")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
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

test("Workshop handoff opens the unified POS with context header and grouped basket lines", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-pos-context",
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "workshop-pos-context",
    retailPricePence: 2199,
  });
  const token = uniqueToken("workshop-pos-context");
  const job = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Workshop ${token}`,
      bikeDescription: `Bike ${token}`,
      notes: `POS context ${token}`,
    },
  });

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/lines`,
    "MANAGER",
    {
      data: {
        type: "PART",
        productId: seeded.product.id,
        variantId: seeded.variant.id,
        qty: 1,
        unitPricePence: 2199,
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/lines`,
    "MANAGER",
    {
      data: {
        type: "LABOUR",
        description: "Workshop labour",
        qty: 1,
        unitPricePence: 3000,
      },
    },
  );

  await page.context().clearCookies();
  await loginViaUi(page, credentials, `/workshop/${job.id}`, { surface: "frontend" });

  await page.getByRole("button", { name: "Send to POS" }).click();
  await expect(page).toHaveURL(/\/pos\?basketId=/);
  await expect(page.getByTestId("pos-context-header")).toContainText(`Workshop Job #${job.id}`);
  await expect(page.getByTestId("pos-context-header")).toContainText(`Workshop ${token}`);
  await expect(page.getByTestId("pos-context-header")).toContainText(`Bike ${token}`);
  await expect(page.locator(".pos-group-row")).toContainText(["Labour", "Parts"]);

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-checkout-summary")).toContainText("Job Total");
  await expect(page.getByTestId("pos-checkout-summary")).toContainText("Remaining");
});

test("POS customer capture link flow attaches captured customer to the active sale", async ({
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

  await page.getByTestId("pos-product-search").fill(seeded.sku);
  await expect(page.getByTestId(`pos-product-add-${seeded.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${seeded.variant.id}`).click();
  await expect(page.getByTestId("pos-checkout-basket")).toBeEnabled();

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-customer-capture-generate")).toBeEnabled();

  await page.getByTestId("pos-customer-capture-generate").click();
  const captureUrlInput = page.getByTestId("pos-customer-capture-url");
  await expect(captureUrlInput).toBeVisible();
  await expect(page.getByTestId("pos-customer-capture-qr")).toBeVisible();
  const captureUrl = await captureUrlInput.inputValue();
  expect(captureUrl).toContain("/customer-capture?token=");

  const capturePage = await context.newPage();
  await capturePage.goto(captureUrl);
  await capturePage.getByTestId("customer-capture-first-name").fill("Taylor");
  await capturePage.getByTestId("customer-capture-last-name").fill("Rider");
  await capturePage.getByTestId("customer-capture-email").fill(`capture-${token}@example.com`);
  await capturePage.getByTestId("customer-capture-phone").fill(uniquePhone);
  await capturePage.getByRole("button", { name: "Save details" }).click();
  await expect(capturePage.getByTestId("customer-capture-success")).toContainText("Details saved.");

  const saleId = new URL(page.url()).searchParams.get("saleId");
  expect(saleId).toBeTruthy();

  await expect(page.getByTestId("pos-selected-customer")).toContainText("Taylor Rider");
  await expect(page.getByText("Customer capture complete.")).toBeVisible();

  await capturePage.goto(new URL("/customer-capture", captureUrl).toString());
  await expect(capturePage.getByText("No active customer capture yet")).toBeVisible();
  await expect(capturePage.getByText("scan the QR code or tap the counter NFC prompt again", { exact: false })).toBeVisible();

  const refreshedSale = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/sales/${encodeURIComponent(saleId)}`,
    "MANAGER",
  );
  expect(refreshedSale.sale.customer?.email).toBe(`capture-${token}@example.com`);
});

test("POS tender checkout supports split tenders and cash overpay change due", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "pos-tenders",
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "pos-tenders",
    retailPricePence: 1000,
  });

  await loginViaUi(page, credentials, "/pos");

  const currentSession = await apiJson(page.request, "GET", "/api/till/sessions/current");
  if (!currentSession?.session?.id) {
    await apiJson(page.request, "POST", "/api/till/sessions/open", {
      data: { openingFloatPence: 0 },
    });
  }
  const baselineSession = await apiJson(page.request, "GET", "/api/till/sessions/current");
  const baselineCashSales = baselineSession?.totals?.cashSalesPence || 0;

  await page.fill("#search-q", seeded.sku);
  await page.click("#search-load");
  await expect(page.locator("#search-status")).toContainText("Loaded");

  const checkoutAndCompleteTenderSale = async (buildTenders) => {
    await page.click("#basket-new");
    await expect(page.locator("#basket-status")).toContainText("Basket created");

    await page.locator(".quick-add-1").first().click();
    await expect(page.locator("#basket-status")).toContainText("Item added.");

    await page.click("#checkout-btn");
    await expect(page.locator("#checkout-status")).toContainText("Checkout");

    await buildTenders();
    await page.click("#tender-complete-btn");
    await expect(page.locator("#tender-status")).toContainText("Sale completed.");
  };

  await checkoutAndCompleteTenderSale(async () => {
    await page.click("#tender-add-cash-remaining");
    await expect(page.locator("#tender-status")).toContainText("Tender added.");
  });
  await expect(page.locator("#sale-receipt")).toContainText("Change Due:");
  await expect(page.locator("#sale-receipt")).toContainText("£0.00");

  await checkoutAndCompleteTenderSale(async () => {
    await page.selectOption("#tender-method", "CASH");
    await page.fill("#tender-amount", "400");
    await page.click("#tender-add-btn");
    await expect(page.locator("#tender-status")).toContainText("Tender added.");
    await page.click("#tender-add-card-remaining");
    await expect(page.locator("#tender-status")).toContainText("Tender added.");
  });
  await expect(page.locator("#sale-receipt")).toContainText("£0.00");

  await checkoutAndCompleteTenderSale(async () => {
    await page.selectOption("#tender-method", "CASH");
    await page.fill("#tender-amount", "1200");
    await page.click("#tender-add-btn");
    await expect(page.locator("#tender-status")).toContainText("Tender added.");
  });
  await expect(page.locator("#sale-receipt")).toContainText("£2.00");

  const afterSession = await apiJson(page.request, "GET", "/api/till/sessions/current");
  expect(afterSession.session.id).toBeTruthy();
  const deltaCashSales = (afterSession.totals?.cashSalesPence || 0) - baselineCashSales;
  expect(deltaCashSales).toBe(2400);
});

test("Login then workshop page can create a job", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-create",
  });
  const token = uniqueToken("workshop-create");
  const customerName = `E2E Customer ${token}`;

  await loginViaUi(page, credentials, "/workshop");
  await page.fill("#create-customer", customerName);
  await page.fill("#create-bike", `E2E Bike ${token}`);
  await page.fill("#create-notes", `E2E notes ${token}`);
  await page.click("#create-job");

  await expect(page.locator("#job-create-status")).toContainText("Job created");
  await expect(page.locator("#selected-job-meta")).toContainText(customerName);
  await expect(page.locator("#jobs-wrap")).toContainText(customerName);
});

test("Workshop page highlights today and keeps the live schedule range today-aware", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-today",
  });
  const todayKey = getLondonDateKey();
  const visibleStart = getOperationalWeekStartDateKey(todayKey);
  const visibleEnd = addDaysToDateKey(visibleStart, 6);
  const nextVisibleStart = getOperationalWeekStartDateKey(addDaysToDateKey(todayKey, 7));

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });

  const headers = page.locator('[data-testid^="workshop-scheduler-day-header-"]');
  await expect(headers).toHaveCount(7);
  await expect(page.getByTestId(`workshop-scheduler-day-header-${todayKey}`)).toHaveAttribute("data-current-day", "true");

  const headerIds = await headers.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-testid")),
  );

  expect(headerIds[0]).toBe(`workshop-scheduler-day-header-${visibleStart}`);
  expect(headerIds[headerIds.length - 1]).toBe(`workshop-scheduler-day-header-${visibleEnd}`);
  const todayIndex = headerIds.indexOf(`workshop-scheduler-day-header-${todayKey}`);
  expect(todayIndex).toBeGreaterThanOrEqual(0);
  expect((headerIds.length - 1) - todayIndex).toBeGreaterThan(todayIndex);

  await page.getByRole("button", { name: "Next Week" }).click();
  await expect(page.getByTestId(`workshop-scheduler-day-header-${todayKey}`)).toHaveCount(0);
  await expect(page.getByTestId(`workshop-scheduler-day-header-${nextVisibleStart}`)).toBeVisible();

  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(page.getByTestId(`workshop-scheduler-day-header-${todayKey}`)).toHaveAttribute("data-current-day", "true");
});

test("Workshop scheduler double click opens intake with a prefilled 30 minute slot", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-double-click",
  });
  const token = uniqueToken("workshop-double-click");
  const todayKey = getLondonDateKey();
  const seededJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Double Click Existing ${token}`,
      bikeDescription: `Existing bike ${token}`,
      status: "BOOKED",
    },
  });

  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(seededJob.id)}/schedule`,
    "MANAGER",
    {
      data: {
        scheduledStartAt: `${todayKey}T10:00:00`,
        durationMinutes: 60,
      },
    },
  );

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });

  const todayTrack = page.getByTestId(`workshop-scheduler-day-track-${todayKey}`);
  await expect(todayTrack).toBeVisible();

  const emptyPoint = await todayTrack.evaluate((track) => {
    const trackRect = track.getBoundingClientRect();
    const timelineOpenMinutes = 8 * 60;
    const timelineCloseMinutes = 19 * 60;
    const schedulerSlotMinutes = 30;
    const slotSafeOffsetMinutes = 8;
    const defaultDurationMinutes = 30;
    const pxPerMinute = trackRect.height / (timelineCloseMinutes - timelineOpenMinutes);
    const blockers = Array.from(
      track.querySelectorAll(".workshop-scheduler-block, .workshop-scheduler-timeoff"),
    )
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left - trackRect.left,
          right: rect.right - trackRect.left,
          top: rect.top - trackRect.top,
          bottom: rect.bottom - trackRect.top,
        };
      })
      .sort((left, right) => left.top - right.top || left.left - right.left);

    const isClear = (xOffset, yOffset) =>
      xOffset > 16
      && xOffset < trackRect.width - 16
      && yOffset > 24
      && yOffset < trackRect.height - 24
      && blockers.every((blocker) =>
        yOffset < blocker.top
        || yOffset > blocker.bottom
        || xOffset < blocker.left
        || xOffset > blocker.right,
      );

    const preferredXOffsets = [
      Math.floor(trackRect.width * 0.5),
      Math.floor(trackRect.width * 0.25),
      Math.floor(trackRect.width * 0.75),
      Math.floor(trackRect.width * 0.125),
      Math.floor(trackRect.width * 0.875),
    ];
    const maxStartMinutes = timelineCloseMinutes - defaultDurationMinutes;
    const preferredSlotStarts = [];

    for (let startMinutes = 12 * 60; startMinutes <= maxStartMinutes; startMinutes += schedulerSlotMinutes) {
      preferredSlotStarts.push(startMinutes);
    }

    for (let startMinutes = timelineOpenMinutes; startMinutes < 12 * 60; startMinutes += schedulerSlotMinutes) {
      preferredSlotStarts.push(startMinutes);
    }

    for (const startMinutes of preferredSlotStarts) {
      const yOffset = Math.floor((startMinutes + slotSafeOffsetMinutes - timelineOpenMinutes) * pxPerMinute);
      if (yOffset <= 24 || yOffset >= trackRect.height - 24) {
        continue;
      }

      for (const xOffset of preferredXOffsets) {
        if (isClear(xOffset, yOffset)) {
          const expectedTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
          return { x: xOffset, y: yOffset, expectedTime };
        }
      }
    }

    throw new Error("Expected to find a clear scheduler slot away from slot boundaries.");
  });

  const trackBox = await todayTrack.boundingBox();
  if (!trackBox) {
    throw new Error("Expected today track to have a bounding box.");
  }

  await todayTrack.dblclick({
    position: {
      x: emptyPoint.x,
      y: emptyPoint.y,
    },
  });

  const intakeDialog = page.getByTestId("workshop-intake");
  await expect(intakeDialog).toBeVisible();
  await expect(intakeDialog.getByTestId("workshop-checkin-planned-slot-summary")).toContainText("30 min");

  await intakeDialog.getByText("Use walk-in name", { exact: true }).click();
  await intakeDialog.getByPlaceholder("Walk-in customer or quick manual entry").fill(`Double Click Intake ${token}`);
  await intakeDialog.getByText("Next", { exact: true }).click();
  await intakeDialog.getByPlaceholder("e.g. Trek road bike, blue, 56cm").fill(`Scheduler Bike ${token}`);
  await intakeDialog.getByText("Next", { exact: true }).click();
  await intakeDialog.getByPlaceholder("Describe the problem or requested work").fill("Scheduler double click check");
  await intakeDialog.getByText("Next", { exact: true }).click();

  await expect(intakeDialog.getByTestId("workshop-checkin-scheduled-date")).toHaveValue(todayKey);
  await expect(intakeDialog.getByTestId("workshop-checkin-scheduled-time")).toHaveValue(emptyPoint.expectedTime);
  await expect(intakeDialog.getByTestId("workshop-checkin-scheduled-duration")).toHaveValue("30");

  await intakeDialog.getByLabel("Close new job modal").click();
  await expect(page.getByTestId("workshop-intake")).toHaveCount(0);

  await page.getByTestId(`workshop-scheduler-job-${seededJob.id}`).dblclick();
  await expect(page.locator(".workshop-checkin-modal")).toHaveCount(0);
});

test("Workshop scheduler shows a live work indicator only for jobs active right now", async ({ page, request }) => {
  const frozenNowIso = "2026-01-15T10:15:00.000Z";
  const todayKey = getLondonDateKey(new Date(frozenNowIso));
  await freezeBrowserClock(page, frozenNowIso);

  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-live-work",
  });
  const token = uniqueToken("workshop-live-work");

  const activeJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Live Work Active ${token}`,
      bikeDescription: `Active bike ${token}`,
      status: "BOOKED",
    },
  });
  const futureJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Live Work Future ${token}`,
      bikeDescription: `Future bike ${token}`,
      status: "BOOKED",
    },
  });
  const readyJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Live Work Ready ${token}`,
      bikeDescription: `Ready bike ${token}`,
      status: "BOOKED",
    },
  });

  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(activeJob.id)}/schedule`,
    "MANAGER",
    {
      data: {
        scheduledStartAt: `${todayKey}T10:00:00`,
        durationMinutes: 60,
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(futureJob.id)}/schedule`,
    "MANAGER",
    {
      data: {
        scheduledStartAt: `${todayKey}T12:00:00`,
        durationMinutes: 30,
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(readyJob.id)}/schedule`,
    "MANAGER",
    {
      data: {
        scheduledStartAt: `${todayKey}T10:00:00`,
        durationMinutes: 60,
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(readyJob.id)}/status`,
    "MANAGER",
    {
      data: {
        status: "READY_FOR_COLLECTION",
      },
    },
  );

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });

  await expect(page.getByTestId(`workshop-scheduler-job-${activeJob.id}`)).toBeVisible();
  await expect(page.getByTestId(`workshop-scheduler-job-${futureJob.id}`)).toBeVisible();
  await expect(page.getByTestId(`workshop-scheduler-job-${readyJob.id}`)).toBeVisible();

  await expect(page.getByTestId(`workshop-scheduler-job-live-${activeJob.id}`)).toBeVisible();
  await expect(page.getByTestId(`workshop-scheduler-job-live-${futureJob.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`workshop-scheduler-job-live-${readyJob.id}`)).toHaveCount(0);

  await page.getByTestId(`workshop-scheduler-job-${activeJob.id}`).click();
  await expect(page.getByTestId("workshop-job-live-status")).toHaveText("Now: Being worked on");
  await page.getByLabel("Close job card").click();
  await expect(page.getByTestId("workshop-job-live-status")).toHaveCount(0);

  await page.getByTestId(`workshop-scheduler-job-${readyJob.id}`).click();
  await expect(page.getByTestId("workshop-job-live-status")).toHaveCount(0);
});

test("Rota planner supports row drag-copy and Fill Mon-Fri without spilling into another staff row", async ({
  page,
  request,
}) => {
  const managerCredentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "rota-manager",
  });
  const token = uniqueToken("rota-drag");
  const alpha = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "rota-alpha",
    name: `Rota Alpha ${token}`,
  });
  const beta = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "rota-beta",
    name: `Rota Beta ${token}`,
  });

  const rotaPeriod = await createRotaPeriodViaBypass(request, "2099-04-06", `Rota drag ${token}`);
  await saveRotaAssignmentViaBypass(request, {
    rotaPeriodId: rotaPeriod.rotaPeriod.id,
    staffId: alpha.user.id,
    date: "2099-04-11",
    shiftType: "HALF_DAY_PM",
  });
  await saveRotaAssignmentViaBypass(request, {
    rotaPeriodId: rotaPeriod.rotaPeriod.id,
    staffId: beta.user.id,
    date: "2099-04-07",
    shiftType: "FULL_DAY",
  });
  await saveRotaAssignmentViaBypass(request, {
    rotaPeriodId: rotaPeriod.rotaPeriod.id,
    staffId: beta.user.id,
    date: "2099-04-08",
    shiftType: "FULL_DAY",
  });

  await loginViaUi(
    page,
    managerCredentials,
    `/management/staff-rota?periodId=${encodeURIComponent(rotaPeriod.rotaPeriod.id)}&staffScope=all&search=${encodeURIComponent(token)}`,
    { surface: "frontend" },
  );

  await expect(page.getByTestId("rota-week-heading")).toContainText("Week 1");
  await page.getByTestId("rota-week-next").click();
  await expect(page.getByTestId("rota-week-heading")).toContainText("Week 2");
  await page.getByTestId("rota-week-prev").click();
  await expect(page.getByTestId("rota-week-heading")).toContainText("Week 1");

  const alphaMonday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-06`);
  const alphaTuesday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-07`);
  const alphaWednesday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-08`);
  const alphaThursday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-09`);
  const alphaFriday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-10`);
  const alphaSaturday = page.getByTestId(`rota-cell-trigger-${alpha.user.id}-2099-04-11`);
  const betaMonday = page.getByTestId(`rota-cell-trigger-${beta.user.id}-2099-04-06`);
  const betaTuesday = page.getByTestId(`rota-cell-trigger-${beta.user.id}-2099-04-07`);
  const betaWednesday = page.getByTestId(`rota-cell-trigger-${beta.user.id}-2099-04-08`);

  await alphaMonday.click();
  await page.getByRole("menuitem", { name: "AM", exact: true }).click();
  await expect(alphaMonday).toContainText("AM");

  await alphaThursday.dblclick();
  await expect(alphaThursday).toContainText("Full");
  await alphaThursday.dblclick();
  await expect(alphaThursday).toContainText("Off");

  await dragBetweenLocators(page, alphaMonday, alphaWednesday);
  await expect(alphaTuesday).toContainText("AM");
  await expect(alphaWednesday).toContainText("AM");
  await expect(betaTuesday).toContainText("Full");
  await expect(betaWednesday).toContainText("Full");

  await dragBetweenLocators(page, betaMonday, betaWednesday);
  await expect(betaTuesday).toContainText("Off");
  await expect(betaWednesday).toContainText("Off");
  await expect(alphaTuesday).toContainText("AM");

  await page.getByTestId(`rota-fill-weekdays-${alpha.user.id}`).click();
  await expect(alphaMonday).toContainText("Full");
  await expect(alphaTuesday).toContainText("Full");
  await expect(alphaWednesday).toContainText("Full");
  await expect(alphaThursday).toContainText("Full");
  await expect(alphaFriday).toContainText("Full");
  await expect(alphaSaturday).toContainText("PM");
});

test("Workshop new job keeps Services -> Review as a non-submitting step", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-review-guard",
  });
  const token = uniqueToken("workshop-review-guard");
  const customerName = `Review Guard ${token}`;
  const bikeName = `Review Bike ${token}`;
  const createRequests = [];

  page.on("request", (pendingRequest) => {
    if (
      pendingRequest.method() === "POST"
      && /\/api\/workshop\/jobs(?:\?|$)/.test(pendingRequest.url())
    ) {
      createRequests.push(pendingRequest.url());
    }
  });

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });
  await page.getByRole("button", { name: "New Job", exact: true }).click();

  const dialog = page.locator('[role="dialog"]').last();
  await dialog.getByText("Use walk-in name", { exact: true }).click();
  await dialog.getByPlaceholder("Walk-in customer or quick manual entry").fill(customerName);
  await dialog.getByText("Next", { exact: true }).click();
  await dialog.getByPlaceholder("e.g. Trek road bike, blue, 56cm").fill(bikeName);
  await dialog.getByText("Next", { exact: true }).click();
  await dialog.getByPlaceholder("Describe the problem or requested work").fill("Review guard repair request");
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByText("Review & Confirm", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Create check-in", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: bikeName, exact: true })).toHaveCount(0);
  expect(createRequests).toHaveLength(0);
});

test("Login then workshop add labour and checkout marks job as collected", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-checkout",
  });
  const token = uniqueToken("workshop-checkout");
  const customerName = `E2E Checkout ${token}`;

  await loginViaUi(page, credentials, "/workshop");
  await page.fill("#create-customer", customerName);
  await page.fill("#create-bike", `E2E Bike ${token}`);
  await page.fill("#create-notes", `Checkout notes ${token}`);

  const createResponsePromise = page.waitForResponse((response) => {
    return (
      response.url().includes("/api/workshop/jobs") &&
      response.request().method() === "POST" &&
      response.status() === 201
    );
  });

  await page.click("#create-job");
  const createResponse = await createResponsePromise;
  const createdJob = await createResponse.json();
  const jobId = createdJob.id;
  if (!jobId) {
    throw new Error("Workshop job create response did not include id");
  }

  await page.fill("#labour-desc", "Safety check labour");
  await page.fill("#labour-qty", "1");
  await page.fill("#labour-price", "5000");
  await page.click("#add-labour-btn");
  await expect(page.locator("#labour-status")).toContainText("Labour line added.");

  const checkout = await apiJson(page.request, "POST", `/api/workshop/jobs/${jobId}/checkout`, {
    data: {
      saleTotalPence: 5000,
      paymentMethod: "CASH",
      amountPence: 5000,
      providerRef: `pw-${token}`,
    },
  });

  expect(checkout.sale.id).toBeTruthy();

  const refreshed = await apiJson(page.request, "GET", `/api/workshop/jobs/${jobId}`);
  expect(refreshed.job.status).toBe("COLLECTED");

  await page.click("#refresh-jobs");
  await expect(page.locator("#jobs-wrap")).toContainText("COLLECTED");
});

test("Login then inventory adjust page can increment on-hand quantity", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "inventory-adjust-login",
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "inventory-adjust",
    initialOnHand: 2,
  });

  await loginViaUi(page, credentials, "/inventory/adjust");
  await page.fill("#search-q", seeded.sku);
  await page.click("#search-btn");

  await expect(page.locator("#search-status")).toContainText("Loaded");
  await expect(page.locator("#selected-variant")).toContainText(seeded.sku);

  const beforeText = await page.locator("#selected-variant").innerText();
  const beforeOnHand = parseOnHand(beforeText);

  await page.fill("#quantity-delta", "1");
  await page.selectOption("#reason", "COUNT_CORRECTION");
  await page.fill("#note", "Playwright +1");
  await page.click("#submit-adjustment");

  await expect(page.locator("#submit-status")).toContainText("Adjustment recorded.");
  await expect(page.locator("#onhand-result")).toContainText(String(beforeOnHand + 1));
});

test("Stocktake scan mode and bulk import build counted lines quickly", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "stocktake-scan-ui",
  });
  const firstVariant = await seedCatalogVariant(request, {
    prefix: "stocktake-scan-first",
    initialOnHand: 4,
  });
  const secondVariant = await seedCatalogVariant(request, {
    prefix: "stocktake-scan-second",
    initialOnHand: 2,
  });

  await loginViaUi(page, credentials, "/inventory/stocktakes", { surface: "frontend" });
  await expect(page.getByRole("heading", { name: "Stocktakes", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create Session", exact: true }).click();
  await expect(page.getByTestId("stocktake-scan-code")).toBeVisible();

  await page.getByTestId("stocktake-scan-code").fill(firstVariant.barcode);
  await page.getByTestId("stocktake-scan-code").press("Enter");
  await expectStocktakeLineCount(page, firstVariant.variant.id, 1);

  await page.getByTestId("stocktake-scan-code").fill(firstVariant.barcode);
  await page.getByTestId("stocktake-scan-code").press("Enter");
  await expectStocktakeLineCount(page, firstVariant.variant.id, 2);

  await page.getByTestId("stocktake-bulk-import").fill(
    `${firstVariant.barcode},4\n${secondVariant.barcode},6`,
  );
  await expect(page.getByTestId("stocktake-bulk-apply")).toBeEnabled();
  await page.getByTestId("stocktake-bulk-apply").click();
  await expectStocktakeLineCount(page, firstVariant.variant.id, 4);
  await expectStocktakeLineCount(page, secondVariant.variant.id, 6);
});

test("Purchase order receiving shortcuts populate remaining quantities without auto-submitting", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "po-receive-shortcuts",
  });
  const token = uniqueToken("po-receive-shortcuts");
  const firstVariant = await seedCatalogVariant(request, {
    prefix: "po-shortcut-a",
    initialOnHand: 1,
  });
  const secondVariant = await seedCatalogVariant(request, {
    prefix: "po-shortcut-b",
    initialOnHand: 0,
  });

  const supplier = await apiJsonWithHeaderBypass(request, "POST", "/api/suppliers", "MANAGER", {
    data: {
      name: `PO Shortcut Supplier ${token}`,
      email: `${token}@supplier.test`,
    },
  });

  const purchaseOrder = await apiJsonWithHeaderBypass(request, "POST", "/api/purchase-orders", "MANAGER", {
    data: {
      supplierId: supplier.id,
      notes: `Shortcut test ${token}`,
    },
  });

  const addItems = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/purchase-orders/${encodeURIComponent(purchaseOrder.id)}/items`,
    "MANAGER",
    {
      data: {
        lines: [
          {
            variantId: firstVariant.variant.id,
            quantityOrdered: 3,
            unitCostPence: 1200,
          },
          {
            variantId: secondVariant.variant.id,
            quantityOrdered: 2,
            unitCostPence: 900,
          },
        ],
      },
    },
  );

  const firstLine = addItems.items.find((item) => item.variantId === firstVariant.variant.id);
  const secondLine = addItems.items.find((item) => item.variantId === secondVariant.variant.id);
  expect(firstLine?.id).toBeTruthy();
  expect(secondLine?.id).toBeTruthy();

  await apiJsonWithHeaderBypass(request, "PATCH", `/api/purchase-orders/${encodeURIComponent(purchaseOrder.id)}`, "MANAGER", {
    data: {
      status: "SENT",
    },
  });

  await page.context().clearCookies();
  await loginViaUi(page, credentials, `/purchasing/${purchaseOrder.id}`, { surface: "frontend" });
  await expect(page.getByRole("heading", { name: "Purchase Order", exact: true })).toBeVisible();
  await expect(page.getByTestId("po-receive-location")).not.toHaveValue("");
  const receiveLocationId = await page.getByTestId("po-receive-location").inputValue();

  await page.getByTestId(`po-receive-fill-${firstLine.id}`).click();
  await expect(page.getByTestId(`po-receive-qty-${firstLine.id}`)).toHaveValue("3");
  await expect(page.getByTestId(`po-receive-qty-${secondLine.id}`)).toHaveValue("");

  const firstReceiveRequestPromise = page.waitForRequest((pendingRequest) => (
    pendingRequest.url().includes(`/api/purchase-orders/${purchaseOrder.id}/receive`)
    && pendingRequest.method() === "POST"
  ));
  await page.getByTestId(`po-receive-submit-${firstLine.id}`).click();
  const firstReceiveRequest = await firstReceiveRequestPromise;
  expect(firstReceiveRequest.postDataJSON()).toEqual({
    locationId: receiveLocationId,
    lines: [
      {
        purchaseOrderItemId: firstLine.id,
        quantity: 3,
        unitCostPence: 1200,
      },
    ],
  });
  await expect(page.locator(".restricted-panel").filter({ hasText: `Received 3 units for ${firstVariant.product.name}.` })).toBeVisible();

  await expect.poll(async () => {
    const afterReceive = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/purchase-orders/${encodeURIComponent(purchaseOrder.id)}`,
      "MANAGER",
    );
    const currentFirstLine = afterReceive.items.find((item) => item.id === firstLine.id);
    const currentSecondLine = afterReceive.items.find((item) => item.id === secondLine.id);
    return JSON.stringify({
      status: afterReceive.status,
      firstRemaining: currentFirstLine?.quantityRemaining ?? null,
      secondRemaining: currentSecondLine?.quantityRemaining ?? null,
    });
  }).toBe(JSON.stringify({
    status: "PARTIALLY_RECEIVED",
    firstRemaining: 0,
    secondRemaining: 2,
  }));

  const afterFirstReceive = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/purchase-orders/${encodeURIComponent(purchaseOrder.id)}`,
    "MANAGER",
  );
  const afterFirstLine = afterFirstReceive.items.find((item) => item.id === firstLine.id);
  const afterSecondLine = afterFirstReceive.items.find((item) => item.id === secondLine.id);
  expect(afterFirstReceive.status).toBe("PARTIALLY_RECEIVED");
  expect(afterFirstLine.quantityRemaining).toBe(0);
  expect(afterSecondLine.quantityRemaining).toBe(2);

  await page.getByTestId("po-receive-fill-all").click();
  await expect(page.getByTestId(`po-receive-qty-${firstLine.id}`)).toHaveValue("");
  await expect(page.getByTestId(`po-receive-qty-${firstLine.id}`)).toBeDisabled();
  await expect(page.getByTestId(`po-receive-qty-${secondLine.id}`)).toHaveValue("2");

  const secondReceiveRequestPromise = page.waitForRequest((pendingRequest) => (
    pendingRequest.url().includes(`/api/purchase-orders/${purchaseOrder.id}/receive`)
    && pendingRequest.method() === "POST"
  ));
  await page.getByTestId(`po-receive-submit-${secondLine.id}`).click();
  const secondReceiveRequest = await secondReceiveRequestPromise;
  expect(secondReceiveRequest.postDataJSON()).toEqual({
    locationId: receiveLocationId,
    lines: [
      {
        purchaseOrderItemId: secondLine.id,
        quantity: 2,
        unitCostPence: 900,
      },
    ],
  });

  await expect.poll(async () => {
    const finalReceive = await apiJsonWithHeaderBypass(
      request,
      "GET",
      `/api/purchase-orders/${encodeURIComponent(purchaseOrder.id)}`,
      "MANAGER",
    );
    return JSON.stringify({
      status: finalReceive.status,
      quantityRemaining: finalReceive.totals.quantityRemaining,
    });
  }).toBe(JSON.stringify({
    status: "RECEIVED",
    quantityRemaining: 0,
  }));

  const finalPurchaseOrder = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/purchase-orders/${encodeURIComponent(purchaseOrder.id)}`,
    "MANAGER",
  );
  expect(finalPurchaseOrder.status).toBe("RECEIVED");
  expect(finalPurchaseOrder.totals.quantityRemaining).toBe(0);
});

test("Admin creates staff and staff cannot access admin endpoints", async ({ page, request }) => {
  const adminCredentials = await ensureUserViaAdminBypass(request, {
    role: "ADMIN",
    prefix: "admin-role-check",
  });

  await loginViaUi(page, adminCredentials, "/admin");
  await expect(page.locator("h1")).toContainText("Admin Users");

  const staffCredentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "admin-created-staff",
  });

  await page.context().clearCookies();
  await loginViaUi(page, staffCredentials, "/pos");

  const forbidden = await page.request.fetch("/api/admin/users");
  expect(forbidden.status()).toBe(403);
});

test("Manager can open till, record paid-in, and close with count", async ({ page, request }) => {
  const managerCredentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "till-manager",
  });

  await loginViaUi(page, managerCredentials, "/till");

  const existing = await apiJson(page.request, "GET", "/api/till/sessions/current");
  if (existing?.session?.id) {
    await apiJson(page.request, "POST", `/api/till/sessions/${existing.session.id}/count`, {
      data: {
        countedCashPence: existing.totals?.expectedCashPence || 0,
        notes: "playwright pre-close",
      },
    });
    await apiJson(page.request, "POST", `/api/till/sessions/${existing.session.id}/close`, {
      data: {},
    });
    await page.reload();
  }

  await page.fill('[data-testid="till-open-float"]', "1000");
  await page.click('[data-testid="till-open-submit"]');
  await expect(page.locator("#open-status")).toContainText("Session opened");

  await page.fill('[data-testid="till-movement-amount"]', "200");
  await page.click('[data-testid="till-movement-submit"]');
  await expect(page.locator("#movement-status")).toContainText("Movement recorded");

  await page.fill('[data-testid="till-counted-cash"]', "1200");
  await page.click("#save-count-btn");
  await expect(page.locator("#close-status")).toContainText("Count saved");

  await page.click('[data-testid="till-close-submit"]');
  await expect(page.locator("#close-status")).toContainText("Session closed");
});
