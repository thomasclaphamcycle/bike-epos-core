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
