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
test("Workshop new job keeps Services -> Review as a non-submitting step", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-review-guard",
  });
  const token = uniqueToken("workshop-review-guard");
  const templateName = `Hub Service ${token}`;
  const customerName = `Review Guard ${token}`;
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: customerName,
      email: `${token}@example.com`,
      phone: `07111${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });
  const bike = await apiJsonWithHeaderBypass(request, "POST", `/api/customers/${encodeURIComponent(customer.id)}/bikes`, "MANAGER", {
    data: {
      make: "Specialized",
      model: `Review Bike ${token}`,
      colour: "Red",
      frameSize: "54cm",
    },
  });
  const secondBike = await apiJsonWithHeaderBypass(request, "POST", `/api/customers/${encodeURIComponent(customer.id)}/bikes`, "MANAGER", {
    data: {
      make: "Trek",
      model: `Switch Bike ${token}`,
      colour: "Blue",
      frameSize: "56cm",
    },
  });
  const thirdBike = await apiJsonWithHeaderBypass(request, "POST", `/api/customers/${encodeURIComponent(customer.id)}/bikes`, "MANAGER", {
    data: {
      make: "Giant",
      model: `Compact Bike ${token}`,
      colour: "Black",
      frameSize: "M",
    },
  });
  const template = await apiJsonWithHeaderBypass(request, "POST", "/api/workshop/service-templates", "MANAGER", {
    data: {
      name: templateName,
      description: "Template restored for workshop intake",
      category: "Service",
      defaultDurationMinutes: 45,
      lines: [
        {
          type: "LABOUR",
          description: "Workshop template labour",
          qty: 1,
          unitPricePence: 4500,
        },
      ],
    },
  });
  const createRequests = [];

  page.on("request", (pendingRequest) => {
    if (
      pendingRequest.method() === "POST"
      && /\/api\/workshop\/jobs(?:\?|$)/.test(pendingRequest.url())
    ) {
      createRequests.push(pendingRequest.url());
    }
  });

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });
  await page.getByRole("button", { name: "New Job", exact: true }).click();

  const dialog = page.locator('[role="dialog"]').last();
  const bikeSelectionSummary = dialog.getByTestId("workshop-checkin-bike-selection");
  await dialog.getByLabel("Search existing customer").fill(customerName);
  await dialog.getByTestId(`workshop-checkin-customer-option-select-${customer.id}`).click();
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByTestId("workshop-checkin-bike-search")).toHaveCount(0);
  await expect(dialog.getByTestId("workshop-checkin-bike-list")).not.toHaveClass(/workshop-checkin-bike-picker__list--scrollable/);
  await expect(dialog.getByTestId(`workshop-checkin-bike-option-${bike.bike.id}`)).toBeVisible();
  await expect(dialog.getByTestId(`workshop-checkin-bike-option-${secondBike.bike.id}`)).toBeVisible();
  await expect(dialog.getByTestId(`workshop-checkin-bike-option-${thirdBike.bike.id}`)).toBeVisible();
  await dialog.getByTestId(`workshop-checkin-bike-option-${bike.bike.id}`).click();
  await expect(bikeSelectionSummary).toContainText("Specialized Review Bike");
  await dialog.getByTestId(`workshop-checkin-bike-option-${secondBike.bike.id}`).click();
  await expect(bikeSelectionSummary).toContainText("Trek Switch Bike");
  await dialog.getByTestId("workshop-checkin-bike-clear").click();
  await expect(dialog.getByTestId("workshop-checkin-bike-clear")).toHaveCount(0);
  await dialog.getByTestId("workshop-checkin-bike-none").click();
  await expect(bikeSelectionSummary).toContainText("No bike attached to this job");
  await dialog.getByText("Next", { exact: true }).click();
  await expect(dialog.getByTestId(`workshop-checkin-service-template-${template.template.id}`)).toBeVisible();
  await expect(dialog.getByTestId(`workshop-checkin-service-template-${template.template.id}`)).toContainText(templateName);
  await expect(dialog.getByTestId("workshop-checkin-service-template-custom")).toBeVisible();
  await dialog.getByPlaceholder("Describe the problem or requested work").fill("Review guard repair request");
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByText("Review & Confirm", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Create check-in", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No bike attached to this job", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No bike linked to this job", { exact: true })).toBeVisible();
  expect(createRequests).toHaveLength(0);
});

test("Workshop new job lets staff continue without a bike when a customer has no saved bikes", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-no-bike",
  });
  const token = uniqueToken("workshop-no-bike");
  const customerName = `No Bike Customer ${token}`;
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: customerName,
      email: `${token}@example.com`,
      phone: `07222${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });
  await page.getByRole("button", { name: "New Job", exact: true }).click();

  const dialog = page.locator('[role="dialog"]').last();
  const bikeSelectionSummary = dialog.getByTestId("workshop-checkin-bike-selection");
  await dialog.getByLabel("Search existing customer").fill(customerName);
  await dialog.getByTestId(`workshop-checkin-customer-option-select-${customer.id}`).click();
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByTestId("workshop-checkin-add-bike")).toBeVisible();
  await expect(dialog.getByTestId("workshop-checkin-bike-none")).toBeVisible();
  await expect(dialog.getByText("No saved bikes found", { exact: false })).toBeVisible();

  await dialog.getByTestId("workshop-checkin-bike-none").click();
  await expect(bikeSelectionSummary).toContainText("No bike attached to this job");
  await dialog.getByText("Next", { exact: true }).click();
  await dialog.getByPlaceholder("Describe the problem or requested work").fill("Customer requested generic workshop advice");
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByText("No bike attached to this job", { exact: true })).toBeVisible();
  await expect(dialog.getByText("No bike linked to this job", { exact: true })).toBeVisible();
});

test("Workshop new job bike selector scrolls only when a customer has more than three bikes", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "workshop-bike-scroll",
  });
  const token = uniqueToken("workshop-bike-scroll");
  const customerName = `Bike Scroll ${token}`;
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      name: customerName,
      email: `${token}@example.com`,
      phone: `07333${Math.floor(Math.random() * 90000) + 10000}`,
    },
  });

  for (const [index, bikeSpec] of [
    ["Trek", "Domane", "Blue", "56cm"],
    ["Specialized", "Allez", "Red", "54cm"],
    ["Cannondale", "Synapse", "Black", "58cm"],
    ["Giant", "Defy", "Grey", "ML"],
  ].entries()) {
    await apiJsonWithHeaderBypass(request, "POST", `/api/customers/${encodeURIComponent(customer.id)}/bikes`, "MANAGER", {
      data: {
        make: bikeSpec[0],
        model: `${bikeSpec[1]} ${token} ${index}`,
        colour: bikeSpec[2],
        frameSize: bikeSpec[3],
      },
    });
  }

  await loginViaUi(page, credentials, "/workshop", { surface: "frontend" });
  await page.getByRole("button", { name: "New Job", exact: true }).click();

  const dialog = page.locator('[role="dialog"]').last();
  const bikeList = dialog.getByTestId("workshop-checkin-bike-list");
  await dialog.getByLabel("Search existing customer").fill(customerName);
  await dialog.getByTestId(`workshop-checkin-customer-option-select-${customer.id}`).click();
  await dialog.getByText("Next", { exact: true }).click();

  await expect(dialog.getByTestId("workshop-checkin-bike-search")).toHaveCount(0);
  await expect(bikeList).toHaveClass(/workshop-checkin-bike-picker__list--scrollable/);
  await expect(bikeList.locator('[data-testid^="workshop-checkin-bike-option-"]')).toHaveCount(4);
});
