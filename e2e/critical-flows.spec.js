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
} = require("./helpers");

const frontendBaseUrl = process.env.REACT_FRONTEND_BASE_URL || "http://localhost:4173";
const toLocalFrontendUrl = (publicUrl) => {
  const parsed = new URL(publicUrl);
  return new URL(`${parsed.pathname}${parsed.search}`, frontendBaseUrl).toString();
};

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

test("Sales History page lists completed sales by default, exposes draft filtering, and opens the receipt route", async ({
  page,
  request,
}) => {
  const token = uniqueToken("sales-history-page");
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "sales-history-page",
    name: `Morgan ${token}`,
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "sales-history-page",
    retailPricePence: 899,
  });
  await ensureOpenRegisterSession(request);

  const completedSale = await seedPosSaleViaBypass(request, {
    variantId: seeded.variant.id,
    role: "MANAGER",
    staffId: credentials.user.id,
    complete: true,
  });
  const draftSale = await seedPosSaleViaBypass(request, {
    variantId: seeded.variant.id,
    role: "MANAGER",
    staffId: credentials.user.id,
    complete: false,
  });

  await loginViaUi(page, credentials, "/sales-history/transactions", { surface: "frontend" });
  await expect(page.getByRole("heading", { name: "Sales History" })).toBeVisible();
  await expect(page.getByTestId("sales-history-status-filter")).toHaveValue("complete");

  await page.getByTestId("sales-history-search").fill(token);
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(token);
  await expect(page.getByTestId(`sales-history-row-${completedSale.saleId}`)).toBeVisible();
  await expect(page.getByTestId(`sales-history-row-${draftSale.saleId}`)).toHaveCount(0);

  await page.getByTestId("sales-history-status-filter").selectOption("complete,draft");
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("complete,draft");
  await expect(page.getByTestId(`sales-history-row-${draftSale.saleId}`)).toBeVisible();
  await expect(page.getByTestId(`sales-history-row-${draftSale.saleId}`)).toContainText("Draft");

  await page.getByTestId(`sales-history-invoice-link-${completedSale.saleId}`).click();
  await expect(page).toHaveURL(new RegExp(`/sales/${completedSale.saleId}/invoice/print`));
  await expect(page.getByTestId("sales-invoice-document")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print A4 invoice" })).toBeVisible();
  await expect(page.locator("body")).toContainText(completedSale.receiptNumber);

  await page.goBack();
  await expect(page.getByTestId(`sales-history-row-${completedSale.saleId}`)).toBeVisible();
  await page.getByTestId(`sales-history-row-${completedSale.saleId}`).click();
  await expect(page).toHaveURL(new RegExp(`/sales/${completedSale.saleId}/receipt/print`));
  await expect(page.getByRole("button", { name: "Print receipt" })).toBeVisible();
  await expect(page.locator("body")).toContainText(completedSale.receiptNumber);
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

test("Inventory detail opens the 2-up A5 bike tag print page", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "bike-tag-print",
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "bike-tag-print",
    retailPricePence: 249900,
  });

  await apiJsonWithHeaderBypass(request, "PATCH", `/api/products/${encodeURIComponent(seeded.product.id)}`, "MANAGER", {
    data: {
      category: "Road Bikes",
      description: "Full carbon gravel bike, Shimano 105 Di2, hydraulic disc brakes, tubeless-ready wheels",
    },
  });

  await loginViaUi(page, credentials, `/inventory/${seeded.variant.id}`, { surface: "frontend" });
  await expect(page.getByRole("heading", { name: "Inventory Detail" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Print bike tag" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Key Selling Points" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate from specs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
  await expect(page.locator("text=Shown on bike tag print preview. One short point per line.")).toBeVisible();
  await expect(page.locator("text=Aim for 3-5 short lines for the clearest printed tag.")).toBeVisible();

  const sellingPointsTextarea = page.locator('textarea[placeholder*="Lightweight aluminium frame"]');
  await sellingPointsTextarea.fill("Custom point");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("This will replace current selling points. Continue?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Generate from specs" }).click();
  await expect(sellingPointsTextarea).toHaveValue("Custom point");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe("This will replace current selling points. Continue?");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Generate from specs" }).click();
  await expect(sellingPointsTextarea).toHaveValue(/Road bike|Full carbon gravel bike|Shimano 105 Di2|hydraulic disc brakes/i);
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(sellingPointsTextarea).toHaveValue("");
  await page.getByRole("button", { name: "Generate from specs" }).click();
  await expect(sellingPointsTextarea).toHaveValue(/Road bike|Full carbon gravel bike|Shimano 105 Di2|hydraulic disc brakes/i);
  await page.getByRole("button", { name: "Print bike tag" }).click();
  await expect(page).toHaveURL(new RegExp(`/variants/${seeded.variant.id}/bike-tag/print`));
  await expect(page.getByRole("heading", { name: "Bike Tag Preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print bike tag sheet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use browser print (fallback)" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Close preview" })).toBeVisible();
  await expect(page.locator(".bike-tag-print-page__copy")).toContainText(
    "Exact A5 landscape bike-tag sheet preview",
  );
  await expect(page.locator(".bike-tag-print-page__copy")).toContainText(
    "same rendered 2-up A6 image CorePOS sends to direct print",
  );
  await expect(page.locator(".bike-tag-print-page__copy")).toContainText(
    "Two identical A6 bike tags sit side by side on one A5 landscape sheet",
  );
  await expect(page.getByTestId("bike-tag-preview-image")).toBeVisible();
  await expect(page.getByTestId("bike-tag-preview-image")).toHaveAttribute(
    "alt",
    new RegExp(`${seeded.product.name}.*bike tag preview`, "i"),
  );
  await expect(page.locator(".app-sidebar")).toHaveCount(0);
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
  const captureUrlInput = page.getByTestId("pos-customer-capture-url");
  await expect(captureUrlInput).toBeVisible();
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

  const firstCaptureUrl = await page.getByTestId("pos-customer-capture-url").inputValue();
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
  const captureUrlInput = page.getByTestId("pos-customer-capture-url");
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

  const captureUrl = await page.getByTestId("pos-customer-capture-url").inputValue();
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
  await expect(page.getByTestId("pos-customer-capture-url")).toHaveValue(/customer-capture\?token=/);
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
  await expect(page.getByTestId("pos-customer-capture-ready-title")).toHaveText("Ready for customer capture");
  await expect(page.getByTestId("pos-customer-capture-ready-helper")).toHaveText(
    "Start a tap request when the customer is ready.",
  );
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

  const captureUrl = await page.getByTestId("pos-customer-capture-url").inputValue();
  const saleId = new URL(page.url()).searchParams.get("saleId");
  expect(saleId).toBeTruthy();

  await page.goto(`${frontendBaseUrl}/pos`);
  await expect(page.getByTestId("pos-customer-capture-url")).toHaveCount(0);

  await page.goto(`${frontendBaseUrl}/pos?saleId=${encodeURIComponent(saleId)}`);
  await expect(page.getByTestId("pos-customer-capture-url")).toHaveValue(captureUrl);
  await expect(page.getByText("Waiting for customer")).toBeVisible();
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

  const captureUrl = await page.getByTestId("pos-customer-capture-url").inputValue();
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

  const captureUrl = await page.getByTestId("pos-customer-capture-url").inputValue();
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

  const printReceiptButton = page.getByTestId("pos-print-receipt-link");
  await expect(printReceiptButton).toBeVisible();

  const receiptOptionsLink = page.getByTestId("pos-receipt-options-link");
  await expect(receiptOptionsLink).toBeVisible();
  const printReceiptHref = await receiptOptionsLink.getAttribute("href");
  expect(printReceiptHref).toBeTruthy();

  const printInvoiceLink = page.getByTestId("pos-print-invoice-link");
  await expect(printInvoiceLink).toBeVisible();
  const printInvoiceHref = await printInvoiceLink.getAttribute("href");
  expect(printInvoiceHref).toBeTruthy();

  await page.goto(`${frontendBaseUrl}${printInvoiceHref}`);
  await expect(page.getByTestId("sales-invoice-document")).toBeVisible();
  await expect(page.getByRole("button", { name: "Print A4 invoice" })).toBeVisible();
  await expect(page.getByTestId("sales-invoice-document")).toContainText(firstVariant.product.name);
  await expect(page.getByTestId("sales-invoice-document")).toContainText(secondVariant.product.name);
  await expect(page.locator(".app-sidebar")).toHaveCount(0);

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

  await expect(page.getByTestId("workshop-job-next-action")).toContainText("Capture the current quote");
  await expect(page.getByTestId("workshop-job-collection-state")).toContainText("Not ready for collection");

  await page.getByTestId("workshop-job-open-pos").click();
  await expect(page).toHaveURL(/\/pos\?basketId=/);
  await expect(page.getByTestId("pos-context-header")).toContainText(`Workshop Job #${job.id}`);
  await expect(page.getByTestId("pos-context-header")).toContainText(`Workshop ${token}`);
  await expect(page.getByTestId("pos-context-header")).toContainText(`Bike ${token}`);
  await expect(page.locator(".pos-group-row")).toContainText(["Labour", "Parts"]);

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-checkout-summary")).toContainText("Job Total");
  await expect(page.getByTestId("pos-checkout-summary")).toContainText("Remaining");
});

test("Workshop job page flags quote drift after approval and keeps the next action explicit", async ({
  page,
  request,
}) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-quote-drift",
  });
  const token = uniqueToken("workshop-quote-drift");
  const job = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerName: `Quote Drift ${token}`,
      bikeDescription: `Bike ${token}`,
      notes: `Quote drift check ${token}`,
      status: "BOOKED",
    },
  });

  const labourLine = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/lines`,
    "MANAGER",
    {
      data: {
        type: "LABOUR",
        description: "Workshop labour",
        qty: 1,
        unitPricePence: 4500,
      },
    },
  );

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/estimate`,
    "MANAGER",
    { data: {} },
  );
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/approval`,
    "MANAGER",
    {
      data: {
        status: "APPROVED",
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(job.id)}/lines/${encodeURIComponent(labourLine.line.id)}`,
    "MANAGER",
    {
      data: {
        description: "Workshop labour plus extra fitting",
        qty: 1,
        unitPricePence: 5200,
      },
    },
  );

  await page.context().clearCookies();
  await loginViaUi(page, credentials, `/workshop/${job.id}`, { surface: "frontend" });

  await expect(page.getByTestId("workshop-job-estimate-state")).toContainText("Changed after approval");
  await expect(page.getByTestId("workshop-job-estimate-state")).toContainText("£52.00");
  await expect(page.getByTestId("workshop-job-next-action")).toContainText("Re-issue the quote");
  await expect(page.getByTestId("workshop-job-next-action")).toContainText("Save revised quote");
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

  await expect(page.getByTestId("workshop-operating-page")).toBeVisible();
  await expect(page.getByTestId("workshop-operating-overview")).toBeVisible();
  await expect(page.getByTestId("workshop-board-overview")).toHaveCount(0);
  await expect(page.getByTestId("workshop-scheduler-unscheduled-panel")).toBeVisible();
  await expect(page.getByTestId("workshop-scheduler-unassigned-panel")).toBeVisible();
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

test("Workshop queue keeps action triage separate from timed scheduling", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-queue",
  });

  await loginViaUi(page, credentials, "/workshop/queue", { surface: "frontend" });

  await expect(page.getByTestId("workshop-queue-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
  await expect(page.getByText("Front of house now")).toBeVisible();
  await expect(page.getByText("Bench now")).toBeVisible();
  await expect(page.getByText("Planning gaps")).toBeVisible();
  await expect(page.getByText("Fast intake")).toBeVisible();
  await expect(page.locator('[data-testid^="workshop-scheduler-day-header-"]')).toHaveCount(0);
});

test("Workshop technician view keeps assigned, blocked, and handoff work execution-first", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "workshop-technician",
  });
  const token = uniqueToken("workshop-technician");
  const assignmentDateKey = await getFirstOpenWorkshopDateKeyViaBypass(request);
  const rotaOverview = await apiJsonWithHeaderBypass(request, "GET", "/api/rota", "MANAGER");
  const currentRotaPeriod = rotaOverview.periods?.find((period) => period.isCurrent) ?? null;
  const createdRotaPeriod = currentRotaPeriod
    ? null
    : await createRotaPeriodViaBypass(
      request,
      getMondayDateKey(assignmentDateKey),
      `Technician workflow ${token}`,
    );
  const rotaPeriodId = currentRotaPeriod?.id ?? createdRotaPeriod?.rotaPeriod?.id ?? null;

  if (typeof rotaPeriodId !== "string" || !rotaPeriodId.trim()) {
    throw new Error("Expected technician workflow setup to resolve a valid rotaPeriodId.");
  }

  await saveRotaAssignmentViaBypass(request, {
    rotaPeriodId,
    staffId: credentials.user.id,
    date: assignmentDateKey,
    shiftType: "FULL_DAY",
  });

  const createAssignedJob = async ({ customerName, bikeDescription, status, startTime, internalNote }) => {
    const job = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
      data: {
        customerName,
        bikeDescription,
        status: "BOOKED",
      },
    });

    await apiJsonWithHeaderBypass(
      request,
      "POST",
      `/api/workshop/jobs/${encodeURIComponent(job.id)}/assign`,
      "MANAGER",
      {
        data: {
          staffId: credentials.user.id,
        },
      },
    );

    await apiJsonWithHeaderBypass(
      request,
      "PATCH",
      `/api/workshop/jobs/${encodeURIComponent(job.id)}/schedule`,
      "MANAGER",
      {
        data: {
          scheduledStartAt: `${assignmentDateKey}T${startTime}:00`,
          durationMinutes: 60,
        },
      },
    );

    if (status !== "BOOKED") {
      await apiJsonWithHeaderBypass(
        request,
        "POST",
        `/api/workshop/jobs/${encodeURIComponent(job.id)}/status`,
        "MANAGER",
        {
          data: {
            status,
          },
        },
      );
    }

    if (internalNote) {
      await apiJsonWithHeaderBypass(
        request,
        "POST",
        `/api/workshop/jobs/${encodeURIComponent(job.id)}/notes`,
        "STAFF",
        {
          headers: {
            "X-Staff-Id": credentials.user.id,
          },
          data: {
            visibility: "INTERNAL",
            note: internalNote,
          },
        },
      );
    }

    return job;
  };

  const actionableJob = await createAssignedJob({
    customerName: `Bench Customer ${token}`,
    bikeDescription: `Bench Bike ${token}`,
    status: "BIKE_ARRIVED",
    startTime: "10:00",
    internalNote: "Bike washed and ready for bench start",
  });
  const blockedJob = await createAssignedJob({
    customerName: `Blocked Customer ${token}`,
    bikeDescription: `Blocked Bike ${token}`,
    status: "WAITING_FOR_PARTS",
    startTime: "12:00",
  });
  await createAssignedJob({
    customerName: `Ready Customer ${token}`,
    bikeDescription: `Ready Bike ${token}`,
    status: "READY_FOR_COLLECTION",
    startTime: "14:00",
  });

  await loginViaUi(page, credentials, "/workshop/technician", { surface: "frontend" });

  await expect(page.getByTestId("workshop-technician-page")).toBeVisible();
  await expect(page.getByTestId("workshop-technician-summary")).toContainText("Actionable now");
  await expect(page.getByTestId("workshop-technician-section-actionable")).toContainText(`Bench Bike ${token}`);
  await expect(page.getByTestId("workshop-technician-section-blocked")).toContainText(`Blocked Bike ${token}`);
  await expect(page.getByTestId("workshop-technician-section-handoff")).toContainText(`Ready Bike ${token}`);

  await page
    .getByTestId(`workshop-technician-card-${actionableJob.id}`)
    .getByRole("button", { name: new RegExp(`Bench Bike ${token}`) })
    .click();

  await expect(page.getByTestId("workshop-technician-detail")).toContainText("Bike washed and ready for bench start");
  await page.getByTestId(`workshop-technician-action-${actionableJob.id}-start-work-detail`).click();
  await expect(page.getByTestId("workshop-technician-detail")).toContainText("In Repair");

  const noteForm = page.getByTestId("workshop-technician-note-form");
  await noteForm.getByRole("textbox").fill("Rear brake bled and final road test still to do");
  await noteForm.getByRole("button", { name: "Save internal note" }).click();
  await expect(page.getByTestId("workshop-technician-detail")).toContainText("Rear brake bled and final road test still to do");
});

test("Workshop scheduler double click opens intake with a prefilled 30 minute slot", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-double-click",
  });
  const token = uniqueToken("workshop-double-click");
  const todayKey = getLondonDateKey();
  const schedulerDateKey = await getFirstOpenWorkshopDateKeyViaBypass(request, "MANAGER", todayKey);
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
        scheduledStartAt: `${schedulerDateKey}T10:00:00`,
        durationMinutes: 60,
      },
    },
  );

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });

  const todayTrack = page.getByTestId(`workshop-scheduler-day-track-${schedulerDateKey}`);
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

  await intakeDialog.getByText("Create new customer", { exact: true }).click();
  await intakeDialog.getByLabel("New customer name").fill(`Double Click Intake ${token}`);
  await intakeDialog.getByText("Next", { exact: true }).click();
  await intakeDialog.getByTestId("workshop-checkin-add-bike").click();
  const bikeDialog = page.getByTestId("workshop-checkin-bike-create");
  await bikeDialog.getByLabel("Brand").fill("Trek");
  await bikeDialog.getByLabel("Model").fill(`Scheduler Bike ${token}`);
  await bikeDialog.getByLabel("Colour").fill("Blue");
  await bikeDialog.getByLabel("Size").fill("56cm");
  await bikeDialog.getByTestId("workshop-checkin-bike-save").click();
  await intakeDialog.getByText("Next", { exact: true }).click();
  await intakeDialog.getByPlaceholder("Describe the problem or requested work").fill("Scheduler double click check");
  await intakeDialog.getByText("Next", { exact: true }).click();

  await expect(intakeDialog.getByTestId("workshop-checkin-scheduled-date")).toHaveValue(schedulerDateKey);
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
  const templateName = `Hub Service ${token}`;
  const customerName = `Review Guard ${token}`;
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: customerName,
      email: `${token}@example.com`,
      phone: `07111${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });
  const bike = await apiJsonWithHeaderBypass(request, "POST", `/api/customers/${encodeURIComponent(customer.id)}/bikes`, "MANAGER", {
    data: {
      make: "Specialized",
      model: `Review Bike ${token}`,
      colour: "Red",
      frameSize: "54cm",
    },
  });
  const secondBike = await apiJsonWithHeaderBypass(request, "POST", `/api/customers/${encodeURIComponent(customer.id)}/bikes`, "MANAGER", {
    data: {
      make: "Trek",
      model: `Switch Bike ${token}`,
      colour: "Blue",
      frameSize: "56cm",
    },
  });
  const thirdBike = await apiJsonWithHeaderBypass(request, "POST", `/api/customers/${encodeURIComponent(customer.id)}/bikes`, "MANAGER", {
    data: {
      make: "Giant",
      model: `Compact Bike ${token}`,
      colour: "Black",
      frameSize: "M",
    },
  });
  const template = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/service-templates", "MANAGER", {
    data: {
      name: templateName,
      description: "Template restored for workshop intake",
      category: "Service",
      defaultDurationMinutes: 45,
      lines: [
        {
          type: "LABOUR",
          description: "Workshop template labour",
          qty: 1,
          unitPricePence: 4500,
        },
      ],
    },
  });
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
  const bikeSelectionSummary = dialog.getByTestId("workshop-checkin-bike-selection");
  await dialog.getByLabel("Search existing customer").fill(customerName);
  await dialog.getByTestId(`workshop-checkin-customer-option-select-${customer.id}`).click();
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByTestId("workshop-checkin-bike-search")).toHaveCount(0);
  await expect(dialog.getByTestId("workshop-checkin-bike-list")).not.toHaveClass(/workshop-checkin-bike-picker__list--scrollable/);
  await expect(dialog.getByTestId(`workshop-checkin-bike-option-${bike.bike.id}`)).toBeVisible();
  await expect(dialog.getByTestId(`workshop-checkin-bike-option-${secondBike.bike.id}`)).toBeVisible();
  await expect(dialog.getByTestId(`workshop-checkin-bike-option-${thirdBike.bike.id}`)).toBeVisible();
  await dialog.getByTestId(`workshop-checkin-bike-option-${bike.bike.id}`).click();
  await expect(bikeSelectionSummary).toContainText("Specialized Review Bike");
  await dialog.getByTestId(`workshop-checkin-bike-option-${secondBike.bike.id}`).click();
  await expect(bikeSelectionSummary).toContainText("Trek Switch Bike");
  await dialog.getByTestId("workshop-checkin-bike-clear").click();
  await expect(dialog.getByTestId("workshop-checkin-bike-clear")).toHaveCount(0);
  await dialog.getByTestId("workshop-checkin-bike-none").click();
  await expect(bikeSelectionSummary).toContainText("No bike attached to this job");
  await dialog.getByText("Next", { exact: true }).click();
  await expect(dialog.getByTestId(`workshop-checkin-service-template-${template.template.id}`)).toBeVisible();
  await expect(dialog.getByTestId(`workshop-checkin-service-template-${template.template.id}`)).toContainText(templateName);
  await expect(dialog.getByTestId("workshop-checkin-service-template-custom")).toBeVisible();
  await dialog.getByPlaceholder("Describe the problem or requested work").fill("Review guard repair request");
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByText("Review & Confirm", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Create check-in", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No bike attached to this job", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No bike linked to this job", { exact: true })).toBeVisible();
  expect(createRequests).toHaveLength(0);
});

test("Workshop new job lets staff continue without a bike when a customer has no saved bikes", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-no-bike",
  });
  const token = uniqueToken("workshop-no-bike");
  const customerName = `No Bike Customer ${token}`;
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: customerName,
      email: `${token}@example.com`,
      phone: `07222${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });
  await page.getByRole("button", { name: "New Job", exact: true }).click();

  const dialog = page.locator('[role="dialog"]').last();
  const bikeSelectionSummary = dialog.getByTestId("workshop-checkin-bike-selection");
  await dialog.getByLabel("Search existing customer").fill(customerName);
  await dialog.getByTestId(`workshop-checkin-customer-option-select-${customer.id}`).click();
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByTestId("workshop-checkin-add-bike")).toBeVisible();
  await expect(dialog.getByTestId("workshop-checkin-bike-none")).toBeVisible();
  await expect(dialog.getByText("No saved bikes found", { exact: false })).toBeVisible();

  await dialog.getByTestId("workshop-checkin-bike-none").click();
  await expect(bikeSelectionSummary).toContainText("No bike attached to this job");
  await dialog.getByText("Next", { exact: true }).click();
  await dialog.getByPlaceholder("Describe the problem or requested work").fill("Customer requested generic workshop advice");
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByText("No bike attached to this job", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No bike linked to this job", { exact: true })).toBeVisible();
});

test("Workshop new job bike selector scrolls only when a customer has more than three bikes", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-bike-scroll",
  });
  const token = uniqueToken("workshop-bike-scroll");
  const customerName = `Bike Scroll ${token}`;
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: customerName,
      email: `${token}@example.com`,
      phone: `07333${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });

  for (const [index, bikeSpec] of [
    ["Trek", "Domane", "Blue", "56cm"],
    ["Specialized", "Allez", "Red", "54cm"],
    ["Cannondale", "Synapse", "Black", "58cm"],
    ["Giant", "Defy", "Grey", "ML"],
  ].entries()) {
    await apiJsonWithHeaderBypass(request, "POST", `/api/customers/${encodeURIComponent(customer.id)}/bikes`, "MANAGER", {
      data: {
        make: bikeSpec[0],
        model: `${bikeSpec[1]} ${token} ${index}`,
        colour: bikeSpec[2],
        frameSize: bikeSpec[3],
      },
    });
  }

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });
  await page.getByRole("button", { name: "New Job", exact: true }).click();

  const dialog = page.locator('[role="dialog"]').last();
  const bikeList = dialog.getByTestId("workshop-checkin-bike-list");
  await dialog.getByLabel("Search existing customer").fill(customerName);
  await dialog.getByTestId(`workshop-checkin-customer-option-select-${customer.id}`).click();
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByTestId("workshop-checkin-bike-search")).toHaveCount(0);
  await expect(bikeList).toHaveClass(/workshop-checkin-bike-picker__list--scrollable/);
  await expect(bikeList.locator('[data-testid^="workshop-checkin-bike-option-"]')).toHaveCount(4);
});

test("Workshop job page surfaces commercial prompts from linked bike history", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-commercial",
  });
  const token = uniqueToken("workshop-commercial");
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: `Commercial Customer ${token}`,
      email: `${token}@example.com`,
      phone: `07111${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });

  const bike = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/customers/${encodeURIComponent(customer.id)}/bikes`,
    "MANAGER",
    {
      data: {
        label: "Daily e-bike",
        make: "Specialized",
        model: `Turbo Vado ${token.slice(-4)}`,
        bikeType: "E_BIKE",
        motorBrand: "Bosch",
        motorModel: "Performance Line",
        colour: "Green",
      },
    },
  );

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/customers/bikes/${encodeURIComponent(bike.bike.id)}/service-schedules`,
    "MANAGER",
    {
      data: {
        type: "BRAKES",
        title: "Brake service",
        description: "Check brake pads, braking surface, and setup.",
        intervalMonths: 6,
        lastServiceAt: "2025-08-01T10:00:00.000Z",
        nextDueAt: "2026-02-01T10:00:00.000Z",
        isActive: true,
      },
    },
  );

  await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/service-templates", "MANAGER", {
    data: {
      name: "Brake service package",
      category: "Brakes",
      description: "Pads, cables, caliper setup, and brake health check.",
      defaultDurationMinutes: 60,
      lines: [
        {
          type: "LABOUR",
          description: "Brake service labour",
          qty: 1,
          unitPricePence: 6500,
          sortOrder: 0,
        },
      ],
    },
  });

  const workshopJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerId: customer.id,
      bikeId: bike.bike.id,
      status: "BOOKED",
      notes: "Customer reports general handling concerns.",
    },
  });

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(workshopJob.id)}/lines`,
    "MANAGER",
    {
      data: {
        type: "LABOUR",
        description: "Wheel true and general workshop assessment",
        qty: 1,
        unitPricePence: 5200,
      },
    },
  );

  await loginViaUi(page, credentials, `/workshop/${workshopJob.id}`, { surface: "frontend" });
  await expect(page.getByTestId("workshop-job-commercial-insights")).toContainText("Offer brake service while the bike is in");
  await expect(page.getByTestId("workshop-job-commercial-insights")).toContainText("Brake service package");
  await expect(page.getByTestId("workshop-job-commercial-insights")).toContainText("Bosch");
});

test("Rental operations routes separate calendar, returns, and customer-linked hire context", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "rental-ops",
  });
  const token = uniqueToken("rental-ops");
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      firstName: "Rental",
      lastName: `Customer ${token}`,
      email: `${token}@example.com`,
      phone: "07700900111",
    },
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "rental-ops",
    retailPricePence: 64000,
    initialOnHand: 0,
  });
  const assetOne = await apiJsonWithHeaderBypass(request, "POST", "/api/hire/assets", "MANAGER", {
    data: {
      variantId: seeded.variant.id,
      assetTag: `E2E-HIRE-${token}-1`,
      displayName: "Weekend rental 1",
      storageLocation: "Front hire rack",
      isOnlineBookable: true,
    },
  });
  const assetTwo = await apiJsonWithHeaderBypass(request, "POST", "/api/hire/assets", "MANAGER", {
    data: {
      variantId: seeded.variant.id,
      assetTag: `E2E-HIRE-${token}-2`,
      displayName: "Weekend rental 2",
      storageLocation: "Returns bay",
    },
  });

  const reservedBooking = await apiJsonWithHeaderBypass(request, "POST", "/api/hire/bookings", "STAFF", {
    data: {
      hireAssetId: assetOne.id,
      customerId: customer.id,
      startsAt: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(),
      dueBackAt: new Date(Date.now() + (26 * 60 * 60 * 1000)).toISOString(),
      hirePricePence: 6500,
      depositPence: 15000,
      notes: "E2E reserved booking",
    },
  });
  const overdueBooking = await apiJsonWithHeaderBypass(request, "POST", "/api/hire/bookings", "STAFF", {
    data: {
      hireAssetId: assetTwo.id,
      customerId: customer.id,
      startsAt: new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString(),
      dueBackAt: new Date(Date.now() - (6 * 60 * 60 * 1000)).toISOString(),
      hirePricePence: 7200,
      depositPence: 18000,
      notes: "E2E overdue booking",
    },
  });
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/hire/bookings/${encodeURIComponent(overdueBooking.id)}/checkout`,
    "STAFF",
    {
      data: {
        depositHeldPence: 18000,
        pickupNotes: "Passport and card pre-auth checked",
      },
    },
  );

  await loginViaUi(page, credentials, "/rental/calendar", { surface: "frontend" });

  await expect(page.getByRole("heading", { name: "Rental Operations" })).toBeVisible();
  await expect(page.getByTestId("rental-route-nav")).toBeVisible();
  await expect(page.getByTestId("rental-calendar-grid")).toBeVisible();
  await expect(page.getByTestId("rental-today-action-centre")).toBeVisible();
  await expect(page.getByText(assetOne.assetTag, { exact: true }).first()).toBeVisible();

  await page.getByTestId("rental-route-nav").getByRole("link", { name: "Returns" }).click();
  await expect(page).toHaveURL(/\/rental\/returns$/);
  await expect(page.getByRole("heading", { name: "Overdue Returns" })).toBeVisible();
  await expect(page.getByText(assetTwo.assetTag, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Return bike" }).first()).toBeVisible();

  await page.goto(`${frontendBaseUrl}/customers/${customer.id}`);
  await expect(page.getByRole("heading", { name: "Rental Activity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active rentals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent rental history" })).toBeVisible();
  await expect(page.getByText("On hire").first()).toBeVisible();

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/hire/bookings/${encodeURIComponent(overdueBooking.id)}/return`,
    "STAFF",
    {
      data: {
        depositOutcome: "RETURNED",
        returnNotes: "Returned after Playwright scenario",
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/hire/bookings/${encodeURIComponent(reservedBooking.id)}/cancel`,
    "STAFF",
    {
      data: {
        cancellationReason: "Playwright cleanup",
      },
    },
  );
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

test("Business intelligence report gives managers one coherent owner view", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "business-intelligence",
  });

  await loginViaUi(page, credentials, "/reports/business-intelligence", { surface: "frontend" });
  await expect(page.getByTestId("business-intelligence-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Business Intelligence" })).toBeVisible();
  await expect(page.getByTestId("bi-card-net-sales")).toBeVisible();
  await expect(page.getByTestId("bi-card-hire-booked-value")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trading Mix" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workshop Performance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hire Performance" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inventory Signals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Customer Signals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trust Notes" })).toBeVisible();
});

test("Public workshop portal shows clear approval and quote-change guidance", async ({ page, request }) => {
  const token = uniqueToken("public-workshop");
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: `Portal Customer ${token}`,
      email: `${token}@example.com`,
      phone: `07111${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });

  const workshopJob = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/jobs", "MANAGER", {
    data: {
      customerId: customer.id,
      bikeDescription: `Portal Bike ${token}`,
      status: "BOOKED",
      notes: `Portal notes ${token}`,
    },
  });

  const line = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(workshopJob.id)}/lines`,
    "MANAGER",
    {
      data: {
        type: "LABOUR",
        description: "Brake service and safety check",
        qty: 1,
        unitPricePence: 6500,
      },
    },
  );

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(workshopJob.id)}/approval`,
    "MANAGER",
    {
      data: {
        status: "WAITING_FOR_APPROVAL",
      },
    },
  );

  const link = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/workshop/jobs/${encodeURIComponent(workshopJob.id)}/customer-quote-link`,
    "MANAGER",
    { data: {} },
  );
  const quoteToken = link.customerQuote.publicPath.split("/").pop();
  if (!quoteToken) {
    throw new Error("Expected customer quote token in public path.");
  }

  await page.goto(`${frontendBaseUrl}/quote/${encodeURIComponent(quoteToken)}`);
  await expect(page.getByTestId("workshop-portal-action-summary")).toContainText("Action needed");
  await expect(page.getByTestId("workshop-portal-action-summary")).toContainText("Approve quote");
  await expect(page.getByTestId("workshop-portal-collection-summary")).toContainText("Approval outstanding");

  await apiJsonWithHeaderBypass(
    request,
    "PATCH",
    `/api/workshop/jobs/${encodeURIComponent(workshopJob.id)}/lines/${encodeURIComponent(line.line.id)}`,
    "MANAGER",
    {
      data: {
        description: "Brake service, cable swap, and safety check",
        qty: 1,
        unitPricePence: 7800,
      },
    },
  );

  await page.reload();
  await expect(page.getByTestId("workshop-portal-action-summary")).toContainText("Quote updated");
  await expect(page.getByTestId("workshop-portal-estimate-changes")).toContainText("Total change: +£13.00");
  await expect(page.getByTestId("workshop-portal-estimate-changes")).toContainText("Brake service, cable swap, and safety check");
});

test("Public workshop site guides customers from landing page into the secure booking journey", async ({ page }) => {
  await page.goto(`${frontendBaseUrl}/`);

  const homePage = page.getByTestId("public-site-home");
  await expect(homePage).toContainText("Book repairs online with a clearer path from drop-off to collection.");
  await expect(page.getByTestId("public-site-journey")).toContainText("Review quoted changes clearly");
  await homePage.getByRole("link", { name: "Book workshop" }).first().click();

  await expect(page).toHaveURL(/\/book-workshop/);
  await expect(page.getByTestId("customer-booking-journey")).toContainText("Approve extra work if needed");
  await expect(page.getByText("What happens after you send")).toBeVisible();
  await page.getByLabel("What would you like us to do?").fill("Front brake rub and gear indexing");
  await page.getByLabel("Bike description").fill("Blue commuter bike with pannier rack");
  await page.getByLabel("First name").fill("Casey");
  await page.getByLabel("Last name").fill("Rider");
  await page.getByLabel("Phone").fill("07111222333");
  await page.getByRole("button", { name: "Send booking request" }).click();

  await expect(page).toHaveURL(/\/bookings\//);
  await expect(page.getByText("Your workshop request has been sent.")).toBeVisible();
  await expect(page.getByTestId("customer-booking-manage-journey")).toContainText("Workshop confirms timing");
  await expect(page.getByText("How quotes and updates arrive")).toBeVisible();
});

test("Customer account access keeps workshop updates persistent beyond one-off links", async ({ page, request }) => {
  const token = uniqueToken("customer-account");
  const email = `${token}@example.com`;
  const bookingMeta = await apiJson(request, "GET", "/api/workshop-bookings/public-form");
  const bookingWindowStart = bookingMeta.booking.minBookableDate.slice(0, 10);
  const bookingWindowEnd = addDaysToDateKey(bookingWindowStart, 14);
  const availability = await apiJson(
    request,
    "GET",
    `/api/workshop/availability?from=${encodeURIComponent(bookingWindowStart)}&to=${encodeURIComponent(bookingWindowEnd)}`,
  );
  const requestedDate = availability.find((day) => day.isBookable)?.date;
  if (!requestedDate) {
    throw new Error("Expected a bookable workshop date for the customer account test.");
  }

  await apiJson(request, "POST", "/api/workshop-bookings", {
    data: {
      firstName: "Avery",
      lastName: "Rider",
      email,
      phone: `07123${Math.floor(Math.random() * 90000) + 10000}`,
      scheduledDate: requestedDate,
      bikeDescription: `Customer Account Bike ${token}`,
      serviceRequest: "Brake rub and shifting under load",
    },
  });

  const access = await apiJson(request, "POST", "/api/customer-auth/request-link", {
    data: {
      email,
      returnTo: "/account",
    },
  });

  expect(access.ok).toBe(true);
  expect(access.devMagicLinkUrl).toBeTruthy();
  const accessToken = new URL(access.devMagicLinkUrl).pathname.split("/").pop();
  if (!accessToken) {
    throw new Error("Expected customer access token in preview link.");
  }

  const consumeResponse = await request.fetch("/api/customer-auth/consume", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    data: {
      token: accessToken,
    },
  });
  expect(consumeResponse.ok()).toBe(true);
  const setCookie = consumeResponse.headers()["set-cookie"];
  if (!setCookie) {
    throw new Error("Expected customer auth cookie from consume response.");
  }
  const [cookiePair] = setCookie.split(";");
  const separatorIndex = cookiePair.indexOf("=");
  const cookieName = cookiePair.slice(0, separatorIndex);
  const cookieValue = cookiePair.slice(separatorIndex + 1);
  await page.context().addCookies([
    {
      name: cookieName,
      value: cookieValue,
      url: frontendBaseUrl,
    },
  ]);

  await page.goto(`${frontendBaseUrl}/account`);
  await expect(page.getByRole("heading", { name: "Avery Rider" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active workshop jobs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: new RegExp(`Customer Account Bike ${token}`) })).toBeVisible();
  await expect(page.getByText("Awaiting your approval").first()).toBeVisible();
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

test("Inventory search can direct-print multiple product-label copies without leaving the workflow", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "inventory-direct-print-ui",
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "inventory-direct-print",
    initialOnHand: 3,
  });
  const printerKey = `E2E_DYMO_${uniqueToken("dymo-ui").replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;

  await apiJsonWithHeaderBypass(request, "POST", "/api/settings/printers", "ADMIN", {
    data: {
      name: "E2E Dymo Product Labels",
      key: printerKey,
      printerFamily: "DYMO_LABEL",
      transportMode: "DRY_RUN",
      location: "Playwright packing bench",
      notes: "Inventory direct-print Playwright printer",
      setAsDefaultProductLabel: true,
    },
  });

  await loginViaUi(page, credentials, "/inventory", { surface: "frontend" });
  await searchInventoryRows(page, seeded.sku);
  await expect(page.getByTestId(`inventory-row-${seeded.variant.id}`)).toBeVisible();

  await page.getByTestId(`inventory-direct-print-3-${seeded.variant.id}`).click();

  await expect(page.locator(".toast.toast-success").last()).toContainText("3 copies");
  await expect(page.getByTestId(`inventory-print-feedback-${seeded.variant.id}`)).toContainText("3 copies");
  await expect(page.getByTestId(`inventory-open-label-page-${seeded.variant.id}`)).toBeVisible();
});

test("Inventory direct-print shows a clear fallback message when the Dymo helper is unavailable", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "inventory-direct-print-offline",
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "inventory-direct-print-offline",
    initialOnHand: 2,
  });

  await loginViaUi(page, credentials, "/inventory", { surface: "frontend" });
  await searchInventoryRows(page, seeded.sku);
  await expect(page.getByTestId(`inventory-row-${seeded.variant.id}`)).toBeVisible();

  await page.route(`**/api/variants/${seeded.variant.id}/product-label/print`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "PRODUCT_LABEL_PRINT_AGENT_UNREACHABLE",
          message: "Product-label print agent could not be reached: connect ECONNREFUSED",
        },
      }),
    });
  });

  await page.getByTestId(`inventory-direct-print-1-${seeded.variant.id}`).click();
  await expect(page.locator(".toast.toast-error").last()).toContainText("Label print helper unavailable");
  await expect(page.getByTestId(`inventory-print-feedback-${seeded.variant.id}`)).toContainText("Label print helper unavailable");
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

test("Manager can generate, prepare, print via agent, and dispatch a web-order shipment label", async ({ page, request }) => {
  const managerCredentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "online-store-dispatch",
  });
  const printerToken = uniqueToken("dispatch-printer");
  const registeredPrinter = await apiJsonWithHeaderBypass(request, "POST", "/api/settings/printers", "ADMIN", {
    data: {
      name: `Dispatch Zebra ${printerToken}`.slice(0, 48),
      key: `DISPATCH_${printerToken}`.toUpperCase(),
      transportMode: "DRY_RUN",
      location: "Playwright dispatch bench",
    },
  });
  await apiJsonWithHeaderBypass(
    request,
    "PUT",
    "/api/settings/printers/default-shipping-label",
    "ADMIN",
    {
      data: {
        printerId: registeredPrinter.printer.id,
      },
    },
  );

  const token = uniqueToken("web-order");
  const createdOrder = await apiJsonWithHeaderBypass(request, "POST", "/api/online-store/orders", "MANAGER", {
    data: {
      orderNumber: `WEB-E2E-${token}`.toUpperCase(),
      sourceChannel: "INTERNAL_MOCK_WEB_STORE",
      externalOrderRef: `checkout-${token}`,
      customerName: "Dispatch Rider",
      customerEmail: `${token}@example.com`,
      customerPhone: "07123 456789",
      shippingRecipientName: "Dispatch Rider",
      shippingAddressLine1: "18 Parcel Walk",
      shippingCity: "Clapham",
      shippingRegion: "London",
      shippingPostcode: "SW4 0HY",
      shippingCountry: "United Kingdom",
      shippingPricePence: 495,
      items: [
        {
          sku: `E2E-SHIP-${token}`.toUpperCase(),
          productName: "Shipment Flow Product",
          variantName: "Standard",
          quantity: 1,
          unitPricePence: 2499,
        },
      ],
    },
  });

  await loginViaUi(page, managerCredentials, "/online-store/orders", {
    surface: "frontend",
    expectedPath: "/online-store/orders",
  });

  await searchOnlineStoreOrders(page, createdOrder.order.orderNumber);
  await expect(page.getByTestId(`online-store-order-row-${createdOrder.order.id}`)).toBeVisible();
  await page.getByTestId(`online-store-order-row-${createdOrder.order.id}`).click();

  await expect(page.getByTestId("online-store-order-detail")).toContainText(createdOrder.order.orderNumber);
  await expect(page.getByTestId("online-store-next-action")).toContainText("Confirm packing");
  await expect(page.getByTestId("online-store-focus-pack")).toBeVisible();
  await expect(page.getByTestId("online-store-readiness")).toContainText("Needs packing");
  await expect(page.getByTestId("online-store-shipment-timeline")).toContainText("No shipment activity yet");
  await expect(page.getByTestId("online-store-packing-handoff")).toContainText("Packing must be confirmed first");
  await page.getByTestId("online-store-mark-packed").click();
  await expect(page.getByTestId("online-store-packing-notice")).toContainText("Generate the shipment label below");
  await expect(page.getByTestId("online-store-packing-session")).toContainText("1 packed");
  await expect(page.getByTestId("online-store-packing-session")).toContainText(createdOrder.order.orderNumber);
  await expect(page.getByTestId("online-store-packing-handoff")).toContainText("Packed and ready for shipment creation");
  await expect(page.getByTestId("online-store-readiness")).toContainText("Packed and ready");
  await expect(page.getByTestId("online-store-readiness")).toContainText("Ready to create");
  await expect(page.getByTestId("online-store-next-action")).toContainText("Generate shipment label");
  await page.getByTestId("online-store-jump-to-shipment").click();
  await page.getByTestId("online-store-generate-label").click();

  await expect.poll(async () => {
    return (await page.getByTestId("online-store-shipment-status").textContent())?.trim() ?? "";
  }).toContain("Label Ready");
  await expect(page.getByTestId("online-store-next-action")).toContainText("Print via Windows agent");
  await expect(page.getByTestId("online-store-prepare-print")).toBeVisible();
  await expect(page.getByTestId("online-store-label-preview")).toContainText("SHIP TO");
  await expect(page.getByTestId("online-store-label-preview")).toContainText("TRACKING NUMBER");
  await expect(page.getByTestId("online-store-label-preview")).toContainText("CorePOS Shipping");
  await expect(page.getByTestId("online-store-label-preview")).not.toContainText("COREPOS DEV SHIPMENT LABEL");
  await expect(page.getByTestId("online-store-shipment-timeline")).toContainText("Shipment created");

  const blockedTrackingNumber = ((await page.getByTestId("online-store-tracking-number").textContent()) ?? "").trim();
  await page.getByTestId("online-store-scan-input").fill(blockedTrackingNumber);
  await page.getByTestId("online-store-scan-input").press("Enter");
  await expect(page.getByTestId("online-store-scan-notice")).toContainText("printed before dispatch");
  await expect(page.getByTestId("online-store-scan-blocked")).toContainText("printed before dispatch");
  await expect(page.getByTestId("online-store-scan-history")).toContainText("Blocked");

  await page.getByTestId("online-store-prepare-print").click();
  await expect(page.getByTestId("online-store-print-request-preview")).toContainText('"transport": "WINDOWS_LOCAL_AGENT"');
  await expect(page.getByTestId("online-store-print-request-preview")).toContainText(`"printerId": "${registeredPrinter.printer.id}"`);
  await expect(page.getByTestId("online-store-print-request-preview")).toContainText('"printerFamily": "ZEBRA_LABEL"');

  await page.getByTestId("online-store-print").click();
  await expect.poll(async () => {
    return (await page.getByTestId("online-store-shipment-status").textContent())?.trim() ?? "";
  }).toContain("Printed");
  await expect(page.getByTestId("online-store-next-action")).toContainText("Confirm dispatch");
  await expect(page.getByTestId("online-store-print")).toContainText("Reprint label");
  await expect(page.getByTestId("online-store-dispatch")).toBeVisible();
  await expect(page.getByTestId("online-store-print-job-result")).toContainText("DRY_RUN");

  const scannedTrackingNumber = ((await page.getByTestId("online-store-tracking-number").textContent()) ?? "").trim();
  await page.getByTestId("online-store-scan-input").fill(scannedTrackingNumber);
  await page.getByTestId("online-store-scan-input").press("Enter");
  await expect(page.getByTestId("online-store-scan-result")).toContainText(createdOrder.order.orderNumber);
  await expect(page.getByTestId("online-store-scan-result")).toContainText("Ready To Dispatch");
  await expect(page.getByTestId("online-store-scan-notice")).toContainText("Press Enter again");
  await page.getByTestId("online-store-scan-input").press("Enter");
  await expect.poll(async () => {
    return (await page.getByTestId("online-store-shipment-status").textContent())?.trim() ?? "";
  }).toContain("Dispatched");
  await expect(page.getByTestId("online-store-next-action")).toContainText("Shipment complete");
  await expect(page.getByTestId("online-store-shipment-timeline")).toContainText("Dispatched");
  await expect(page.getByTestId("online-store-scan-input")).toHaveValue("");
  await expect(page.getByTestId("online-store-scan-input")).toBeFocused();
  await expect(page.getByTestId("online-store-scan-notice")).toContainText("ready for the next scan");
  await expect(page.getByTestId("online-store-scan-session")).toContainText("1 dispatched");
  await expect(page.getByTestId("online-store-scan-history")).toContainText("Dispatch confirmed");

  const finalOrder = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/online-store/orders/${encodeURIComponent(createdOrder.order.id)}`,
    "MANAGER",
  );
  expect(finalOrder.order.status).toBe("DISPATCHED");
  expect(finalOrder.order.shipments[0].status).toBe("DISPATCHED");
  expect(finalOrder.order.shipments[0].trackingNumber).toMatch(/^MOCK/);
});

test("Manager can bulk-create, bulk-print, and bulk-dispatch packed web orders", async ({ page, request }) => {
  const managerCredentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "online-store-bulk-dispatch",
  });
  const bulkToken = uniqueToken("web-order-bulk");
  const printerToken = uniqueToken("dispatch-bulk-printer");
  const registeredPrinter = await apiJsonWithHeaderBypass(request, "POST", "/api/settings/printers", "ADMIN", {
    data: {
      name: `Dispatch Zebra ${printerToken}`.slice(0, 48),
      key: `DISPATCH_${printerToken}`.toUpperCase(),
      transportMode: "DRY_RUN",
      location: "Playwright dispatch bench",
    },
  });
  await apiJsonWithHeaderBypass(
    request,
    "PUT",
    "/api/settings/printers/default-shipping-label",
    "ADMIN",
    {
      data: {
        printerId: registeredPrinter.printer.id,
      },
    },
  );

  const orderIds = [];
  for (let index = 0; index < 2; index += 1) {
    const token = `${bulkToken}-${index + 1}`;
    const createdOrder = await apiJsonWithHeaderBypass(request, "POST", "/api/online-store/orders", "MANAGER", {
      data: {
        orderNumber: `WEB-BULK-E2E-${token}`.toUpperCase(),
        sourceChannel: "INTERNAL_MOCK_WEB_STORE",
        externalOrderRef: `checkout-${token}`,
        customerName: `Bulk Dispatch ${index + 1}`,
        customerEmail: `${token}@example.com`,
        customerPhone: "07123 456789",
        shippingRecipientName: `Bulk Dispatch ${index + 1}`,
        shippingAddressLine1: "18 Parcel Walk",
        shippingCity: "Clapham",
        shippingRegion: "London",
        shippingPostcode: "SW4 0HY",
        shippingCountry: "United Kingdom",
        shippingPricePence: 495,
        items: [
          {
            sku: `E2E-BULK-SHIP-${token}`.toUpperCase(),
            productName: "Bulk Shipment Flow Product",
            variantName: "Standard",
            quantity: 1,
            unitPricePence: 2499,
          },
        ],
      },
    });
    orderIds.push(createdOrder.order.id);
    await markWebOrderPackedViaBypass(request, createdOrder.order.id);
  }

  await loginViaUi(page, managerCredentials, "/online-store/orders", {
    surface: "frontend",
    expectedPath: "/online-store/orders",
  });

  await searchOnlineStoreOrders(page, bulkToken);
  await expect(page.getByTestId("online-store-closeout")).toContainText("Dispatch closeout / handoff");
  await expect(page.getByTestId("online-store-closeout-summary-text")).toContainText("0 dispatched today");
  await expect(page.getByTestId("online-store-closeout-summary-text")).toContainText("2 packed and ready for shipment creation");
  await expect(page.getByTestId(`online-store-order-row-${orderIds[0]}`)).toBeVisible();
  await expect(page.getByTestId(`online-store-order-row-${orderIds[1]}`)).toBeVisible();
  await page.getByTestId(`online-store-select-order-${orderIds[0]}`).check();
  await page.getByTestId(`online-store-select-order-${orderIds[1]}`).check();
  await page.getByTestId("online-store-bulk-create").click();
  await expect(page.getByTestId("online-store-bulk-results")).toContainText("2 succeeded");

  await page.getByTestId("online-store-bulk-print").click();
  await expect(page.getByTestId("online-store-bulk-results")).toContainText("Bulk label print");
  await expect(page.getByTestId("online-store-bulk-results")).toContainText("2 succeeded");

  await page.getByTestId("online-store-bulk-dispatch").click();
  await expect(page.getByTestId("online-store-bulk-results")).toContainText("Bulk dispatch confirmation");
  await expect(page.getByTestId("online-store-bulk-results")).toContainText("2 succeeded");
  await expect(page.getByTestId("online-store-closeout")).toContainText("Bench clear in visible scope");
  await expect(page.getByTestId("online-store-closeout-summary-text")).toContainText("2 dispatched today");
  await expect(page.getByTestId("online-store-closeout-summary-text")).toContainText("0 printed but not dispatched");
  await expect(page.getByTestId("online-store-closeout-summary-text")).toContainText("0 blocked or review-needed");

  const firstOrder = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/online-store/orders/${encodeURIComponent(orderIds[0])}`,
    "MANAGER",
  );
  expect(firstOrder.order.status).toBe("DISPATCHED");
  expect(firstOrder.order.shipments[0].status).toBe("DISPATCHED");

  const secondOrder = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/online-store/orders/${encodeURIComponent(orderIds[1])}`,
    "MANAGER",
  );
  expect(secondOrder.order.status).toBe("DISPATCHED");
  expect(secondOrder.order.shipments[0].status).toBe("DISPATCHED");
});
