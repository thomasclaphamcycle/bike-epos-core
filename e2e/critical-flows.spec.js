const { test, expect } = require("@playwright/test");
const {
  apiJson,
  apiJsonWithHeaderBypass,
  ensureUserViaAdminBypass,
  loginViaUi,
  seedCatalogVariant,
  uniqueToken,
} = require("./helpers");

const parseOnHand = (labelText) => {
  const match = labelText.match(/On hand:\s*(-?\d+)/i);
  if (!match) {
    throw new Error(`Could not parse on-hand from "${labelText}"`);
  }
  return Number.parseInt(match[1], 10);
};

test.describe.configure({ mode: "serial" });

test("Auth routing redirects and navigation visibility follows role", async ({ page, request }) => {
  await page.context().clearCookies();
  await page.goto("/workshop");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkshop/);

  const staffCredentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "nav-staff",
  });
  await loginViaUi(page, staffCredentials, "/pos", { surface: "frontend" });
  await expect(page.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Products", exact: true })).toHaveCount(0);
  await page.goto("/workshop");
  await expect(page).toHaveURL(/\/workshop/);

  const managerCredentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "nav-manager",
  });
  await page.context().clearCookies();
  await loginViaUi(page, managerCredentials, "/pos", { surface: "frontend" });
  await expect(page.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Products", exact: true })).toBeVisible();
  await page.goto("/management/cash");
  await expect(page).toHaveURL(/\/management\/cash/);

  const adminCredentials = await ensureUserViaAdminBypass(request, {
    role: "ADMIN",
    prefix: "nav-admin",
  });
  await page.context().clearCookies();
  await loginViaUi(page, adminCredentials, "/admin", { surface: "frontend" });
  await expect(page.getByRole("link", { name: "POS", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Products", exact: true })).toBeVisible();
  await page.goto("/management/staff");
  await expect(page).toHaveURL(/\/management\/staff/);
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

  await page.getByTestId("pos-customer-search").fill(firstCustomer.name);
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
  await expect(page.getByText("No customer selected.")).toBeVisible();

  await page.getByTestId("pos-customer-search").fill(secondCustomer.email);
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
