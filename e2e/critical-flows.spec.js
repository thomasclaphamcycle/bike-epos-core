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

const parseOnHand = (labelText) => {
  const match = labelText.match(/On hand:\s*(-?\d+)/i);
  if (!match) {
    throw new Error(`Could not parse on-hand from "${labelText}"`);
  }
  return Number.parseInt(match[1], 10);
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

test.describe.configure({ mode: "serial" });

test("Auth routing redirects and navigation visibility follows role", async ({ page, request }) => {
  const primaryNav = page.getByRole("navigation", { name: "Primary navigation" });

  await page.context().clearCookies();
  await page.goto("/workshop");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkshop/);

  const staffCredentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "nav-staff",
  });
  await loginViaUi(page, staffCredentials, "/pos", { surface: "frontend" });
  await expect(primaryNav.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Cash Management", exact: true })).toHaveCount(0);
  await expect(primaryNav.getByRole("link", { name: "Back Office", exact: true })).toHaveCount(0);
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
    expectedPath: "/management",
  });
  await expect(primaryNav.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Cash Management", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Back Office", exact: true })).toBeVisible();
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
    expectedPath: "/management/staff",
  });
  await expect(primaryNav.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(primaryNav.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await page.goto("/management/staff");
  await expect(page).toHaveURL(/\/management\/staff/);
});

test("Password fallback login works for active users without a PIN", async ({ page, request }) => {
  const passwordOnlyCredentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "password-fallback",
    withPin: false,
  });
  const passwordOnlyButton = page.getByTestId(`login-user-${passwordOnlyCredentials.user.id}`);

  await page.goto(`${frontendBaseUrl}/login`);
  await expect(passwordOnlyButton).toContainText("Password only");
  await passwordOnlyButton.click();
  await expect(page.getByText("This account does not have a PIN yet. Use email and password below.")).toBeVisible();
  await expect(page.getByTestId("login-pin")).toBeDisabled();

  await page.getByTestId("login-password-email").fill(passwordOnlyCredentials.email);
  await page.getByTestId("login-password-value").fill(passwordOnlyCredentials.password);
  await page.getByTestId("login-password-submit").click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
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

  await page.getByTestId("pos-product-search").fill(seeded.sku);
  await expect(page.getByTestId(`pos-product-add-${seeded.variant.id}`)).toBeVisible();
  await page.getByTestId(`pos-product-add-${seeded.variant.id}`).click();

  await page.getByTestId("pos-checkout-basket").click();
  await expect(page.getByTestId("pos-selected-customer")).toContainText("Attached to sale");

  const saleIdAfterCheckout = new URL(page.url()).searchParams.get("saleId");
  expect(saleIdAfterCheckout).toBeTruthy();

  await page.getByTestId("pos-customer-clear").click();
  await expect(page.getByText("No customer selected yet. Search below or leave this sale as walk-in.")).toBeVisible();

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

  await page.getByTestId(`po-receive-fill-${firstLine.id}`).click();
  await expect(page.getByTestId(`po-receive-qty-${firstLine.id}`)).toHaveValue("3");
  await expect(page.getByTestId(`po-receive-qty-${secondLine.id}`)).toHaveValue("");

  await Promise.all([
    page.waitForResponse((response) => (
      response.url().includes(`/api/purchase-orders/${purchaseOrder.id}/receive`)
      && response.request().method() === "POST"
      && response.status() === 200
    )),
    page.getByTestId(`po-receive-submit-${firstLine.id}`).click(),
  ]);
  await expect(page.locator(".restricted-panel").filter({ hasText: `Received 3 units for ${firstVariant.product.name}.` })).toBeVisible();

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

  await Promise.all([
    page.waitForResponse((response) => (
      response.url().includes(`/api/purchase-orders/${purchaseOrder.id}/receive`)
      && response.request().method() === "POST"
      && response.status() === 200
    )),
    page.getByTestId(`po-receive-submit-${secondLine.id}`).click(),
  ]);

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
