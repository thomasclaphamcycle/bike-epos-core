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
