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
