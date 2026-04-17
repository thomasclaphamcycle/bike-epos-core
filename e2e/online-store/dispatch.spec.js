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
