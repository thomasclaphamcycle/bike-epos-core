const { test, expect } = require("@playwright/test");
const {
  apiJson,
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
  await loginViaUi(page, staffCredentials, "/pos");
  await expect(page.getByTestId("app-nav-pos")).toBeVisible();
  await expect(page.getByTestId("app-nav-workshop")).toBeVisible();
  await expect(page.getByTestId("app-nav-inventory")).toBeVisible();
  await expect(page.locator('[data-testid="app-nav-till"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="app-nav-admin-users"]')).toHaveCount(0);
  await page.click('[data-testid="app-nav-workshop"]');
  await expect(page).toHaveURL(/\/workshop/);

  const managerCredentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "nav-manager",
  });
  await page.context().clearCookies();
  await loginViaUi(page, managerCredentials, "/pos");
  await expect(page.getByTestId("app-nav-till")).toBeVisible();
  await expect(page.locator('[data-testid="app-nav-admin-users"]')).toHaveCount(0);
  await page.click('[data-testid="app-nav-till"]');
  await expect(page).toHaveURL(/\/till/);

  const adminCredentials = await ensureUserViaAdminBypass(request, {
    role: "ADMIN",
    prefix: "nav-admin",
  });
  await page.context().clearCookies();
  await loginViaUi(page, adminCredentials, "/admin");
  await expect(page.getByTestId("app-nav-admin-users")).toBeVisible();
  await expect(page.getByTestId("app-nav-admin-audit")).toBeVisible();
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

  const receiptLink = page.locator('#sale-receipt a[href^="/sales/"][href$="/receipt"]');
  await expect(receiptLink).toHaveCount(1);

  const href = await receiptLink.first().getAttribute("href");
  if (!href) {
    throw new Error("Receipt link href was empty");
  }

  await page.goto(href);
  await expect(page.locator("body")).toContainText("Receipt:");
  await expect(page.locator("body")).toContainText(seeded.sku);
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
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
