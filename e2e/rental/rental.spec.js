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
test("Rental operations routes separate calendar, returns, and customer-linked hire context", async ({ page, request }) => {
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "MANAGER",
    prefix: "rental-ops",
  });
  const token = uniqueToken("rental-ops");
  const customer = await apiJsonWithHeaderBypass(request, "POST", "/api/customers", "MANAGER", {
    data: {
      firstName: "Rental",
      lastName: `Customer ${token}`,
      email: `${token}@example.com`,
      phone: "07700900111",
    },
  });
  const seeded = await seedCatalogVariant(request, {
    prefix: "rental-ops",
    retailPricePence: 64000,
    initialOnHand: 0,
  });
  const assetOne = await apiJsonWithHeaderBypass(request, "POST", "/api/hire/assets", "MANAGER", {
    data: {
      variantId: seeded.variant.id,
      assetTag: `E2E-HIRE-${token}-1`,
      displayName: "Weekend rental 1",
      storageLocation: "Front hire rack",
      isOnlineBookable: true,
    },
  });
  const assetTwo = await apiJsonWithHeaderBypass(request, "POST", "/api/hire/assets", "MANAGER", {
    data: {
      variantId: seeded.variant.id,
      assetTag: `E2E-HIRE-${token}-2`,
      displayName: "Weekend rental 2",
      storageLocation: "Returns bay",
    },
  });

  const reservedBooking = await apiJsonWithHeaderBypass(request, "POST", "/api/hire/bookings", "STAFF", {
    data: {
      hireAssetId: assetOne.id,
      customerId: customer.id,
      startsAt: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(),
      dueBackAt: new Date(Date.now() + (26 * 60 * 60 * 1000)).toISOString(),
      hirePricePence: 6500,
      depositPence: 15000,
      notes: "E2E reserved booking",
    },
  });
  const overdueBooking = await apiJsonWithHeaderBypass(request, "POST", "/api/hire/bookings", "STAFF", {
    data: {
      hireAssetId: assetTwo.id,
      customerId: customer.id,
      startsAt: new Date(Date.now() - (48 * 60 * 60 * 1000)).toISOString(),
      dueBackAt: new Date(Date.now() - (6 * 60 * 60 * 1000)).toISOString(),
      hirePricePence: 7200,
      depositPence: 18000,
      notes: "E2E overdue booking",
    },
  });
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/hire/bookings/${encodeURIComponent(overdueBooking.id)}/checkout`,
    "STAFF",
    {
      data: {
        depositHeldPence: 18000,
        pickupNotes: "Passport and card pre-auth checked",
      },
    },
  );

  await loginViaUi(page, credentials, "/rental/calendar", { surface: "frontend" });

  await expect(page.getByRole("heading", { name: "Rental Operations" })).toBeVisible();
  await expect(page.getByTestId("rental-route-nav")).toBeVisible();
  await expect(page.getByTestId("rental-calendar-grid")).toBeVisible();
  await expect(page.getByTestId("rental-today-action-centre")).toBeVisible();
  await expect(page.getByText(assetOne.assetTag, { exact: true }).first()).toBeVisible();

  await page.getByTestId("rental-route-nav").getByRole("link", { name: "Returns" }).click();
  await expect(page).toHaveURL(/\/rental\/returns$/);
  await expect(page.getByRole("heading", { name: "Overdue Returns" })).toBeVisible();
  await expect(page.getByText(assetTwo.assetTag, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Return bike" }).first()).toBeVisible();

  await page.goto(`${frontendBaseUrl}/customers/${customer.id}`);
  await expect(page.getByRole("heading", { name: "Rental Activity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active rentals" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent rental history" })).toBeVisible();
  await expect(page.getByText("On hire").first()).toBeVisible();

  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/hire/bookings/${encodeURIComponent(overdueBooking.id)}/return`,
    "STAFF",
    {
      data: {
        depositOutcome: "RETURNED",
        returnNotes: "Returned after Playwright scenario",
      },
    },
  );
  await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/hire/bookings/${encodeURIComponent(reservedBooking.id)}/cancel`,
    "STAFF",
    {
      data: {
        cancellationReason: "Playwright cleanup",
      },
    },
  );
});
