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
test("PIN login hides users without a PIN and keeps PIN entry disabled until a PIN user is selected", async ({
  page,
  request,
}) => {
  const reactFrontendUrl = process.env.REACT_FRONTEND_BASE_URL || "http://localhost:4173";
  const credentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "pinless-login",
    withPin: false,
  });

  await page.goto(`${reactFrontendUrl}/login`);
  await expect(page.getByTestId(`login-user-${credentials.user.id}`)).toHaveCount(0);
  await expect(page.getByTestId("login-pin")).toBeDisabled();
});

test("Login page stays PIN-only and hides users without a PIN", async ({ page, request }) => {
  const passwordOnlyCredentials = await ensureUserViaAdminBypass(request, {
    role: "STAFF",
    prefix: "password-fallback",
    withPin: false,
  });
  const passwordOnlyButton = page.getByTestId(`login-user-${passwordOnlyCredentials.user.id}`);

  await page.goto(`${frontendBaseUrl}/login`);
  await expect(passwordOnlyButton).toHaveCount(0);
  await expect(page.getByText("Password fallback")).toHaveCount(0);
  await expect(page.getByTestId("login-password-email")).toHaveCount(0);
  await expect(page.getByTestId("login-password-value")).toHaveCount(0);
  await expect(page.getByTestId("login-password-submit")).toHaveCount(0);
  await expect(page.getByTestId("login-pin")).toBeDisabled();
});
