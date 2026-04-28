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
  await expect(page.getByTestId("pos-context-header")).toContainText("Workshop Sale");
  await expect(page.getByTestId("pos-context-header")).toContainText(`Job #${job.id}`);
  await expect(page.getByTestId("pos-context-header")).toContainText(`Workshop ${token}`);
  await expect(page.getByTestId("pos-context-header")).toContainText(`Bike ${token}`);
  await expect(page.locator(".pos-group-row")).toContainText(["Labour", "Parts"]);

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-checkout-summary")).toContainText("Job Total");
  await expect(page.getByTestId("pos-checkout-summary")).toContainText("Remaining");
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
