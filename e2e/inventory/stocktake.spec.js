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
