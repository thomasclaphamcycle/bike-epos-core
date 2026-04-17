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
