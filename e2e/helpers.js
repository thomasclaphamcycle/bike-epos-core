const buildHeaderBypassHeaders = (role = "STAFF") => {
  const headers = {
    "X-Staff-Role": role,
    "X-Staff-Id": role === "ADMIN" ? "e2e-admin-bypass" : role === "MANAGER" ? "e2e-manager-bypass" : "e2e-staff-bypass",
  };

  if (process.env.INTERNAL_AUTH_SHARED_SECRET) {
    headers["X-Internal-Auth"] = process.env.INTERNAL_AUTH_SHARED_SECRET;
  }

  return headers;
};

const readJsonBody = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const getLondonDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
};

const parseDateKeyAtNoon = (dateKey) => new Date(`${dateKey}T12:00:00`);

const addDaysToDateKey = (dateKey, days) => {
  const next = parseDateKeyAtNoon(dateKey);
  next.setDate(next.getDate() + days);
  return getLondonDateKey(next);
};

const getMondayDateKey = (anchorDateKey) => {
  const anchor = parseDateKeyAtNoon(anchorDateKey);
  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  anchor.setDate(anchor.getDate() + mondayOffset);
  return getLondonDateKey(anchor);
};

const getOperationalWeekStartDateKey = (anchorDateKey) => {
  const anchor = parseDateKeyAtNoon(anchorDateKey);
  const day = anchor.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = parseDateKeyAtNoon(anchorDateKey);
  monday.setDate(monday.getDate() + mondayOffset);
  const weekdayIndex = (day + 6) % 7;
  if (weekdayIndex <= 2) {
    return getLondonDateKey(monday);
  }
  return addDaysToDateKey(anchorDateKey, -2);
};

const apiJson = async (request, method, path, options = {}) => {
  const response = await request.fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...(options.data !== undefined ? { data: options.data } : {}),
  });

  const payload = await readJsonBody(response);
  if (!response.ok()) {
    throw new Error(
      `${method} ${path} failed (${response.status()}): ${JSON.stringify(payload)}`,
    );
  }

  return payload;
};

const apiJsonWithHeaderBypass = async (
  request,
  method,
  path,
  role,
  options = {},
) => {
  return apiJson(request, method, path, {
    ...options,
    headers: {
      ...buildHeaderBypassHeaders(role),
      ...(options.headers || {}),
    },
  });
};

let sequence = 0;
const uniqueToken = (prefix = "e2e") => `${prefix}-${Date.now()}-${++sequence}`;
const frontendBaseUrl = process.env.REACT_FRONTEND_BASE_URL || "http://localhost:4173";
const backendBaseUrl = process.env.TEST_BASE_URL || "http://localhost:3100";

const ensureUserViaAdminBypass = async (
  request,
  options = {},
) => {
  const token = uniqueToken(options.prefix || "user");
  const role = options.role || "MANAGER";
  const email = `${token}@example.com`;
  const password = options.password || `Playwright!${token}`;
  const pin = options.pin || "1234";
  const withPin = options.withPin !== false;
  const name = options.name || `${role} ${token}`;

  const payload = await apiJsonWithHeaderBypass(request, "POST", "/api/admin/users", "ADMIN", {
    data: {
      name,
      email,
      role,
      tempPassword: password,
    },
  });

  if (withPin) {
    await apiJsonWithHeaderBypass(request, "POST", "/api/auth/pin", role, {
      headers: {
        "X-Staff-Id": payload.user.id,
      },
      data: {
        pin,
      },
    });
  }

  return {
    user: payload.user,
    email,
    password,
    ...(withPin ? { pin } : {}),
  };
};

const loginViaUi = async (page, credentials, nextPath = "/pos", options = {}) => {
  const resolvedNextPath = nextPath === undefined ? "/pos" : nextPath;
  const expectedPath = options.expectedPath ?? resolvedNextPath;
  const surface = options.surface || "legacy";
  if (surface === "frontend") {
    const loginUrl = resolvedNextPath
      ? `${frontendBaseUrl}/login?next=${encodeURIComponent(resolvedNextPath)}`
      : `${frontendBaseUrl}/login`;
    await page.goto(loginUrl);
    await page.click(`[data-testid="login-user-${credentials.user.id}"]`);
    await page.fill('[data-testid="login-pin"]', credentials.pin);
    if (expectedPath) {
      await page.waitForURL(new RegExp(`${expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), {
        timeout: 6000,
      });
    }
    return;
  }
  const loginUrl = resolvedNextPath
    ? `${backendBaseUrl}/login?next=${encodeURIComponent(resolvedNextPath)}`
    : `${backendBaseUrl}/login`;
  await page.goto(loginUrl);
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Login" }).click();
  if (expectedPath) {
    await page.waitForURL(new RegExp(`${expectedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
};

const seedCatalogVariant = async (request, options = {}) => {
  const token = uniqueToken(options.prefix || "catalog");
  const product = await apiJsonWithHeaderBypass(request, "POST", "/api/products", "MANAGER", {
    data: {
      name: `E2E Product ${token}`,
      brand: "E2E",
      description: "Playwright seeded product",
    },
  });

  const sku = `E2E-${token.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
  const barcode = options.barcode || `BC-${token.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
  const variant = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/products/${encodeURIComponent(product.id)}/variants`,
    "MANAGER",
    {
      data: {
        sku,
        barcode,
        name: `E2E Variant ${token}`,
        retailPricePence: options.retailPricePence ?? 1499,
      },
    },
  );

  const initialOnHand = options.initialOnHand ?? 4;
  if (initialOnHand !== 0) {
    await apiJsonWithHeaderBypass(request, "POST", "/api/inventory/adjustments", "MANAGER", {
      data: {
        variantId: variant.id,
        quantityDelta: initialOnHand,
        reason: "COUNT_CORRECTION",
        note: `playwright seed ${token}`,
      },
    });
  }

  return {
    token,
    product,
    variant,
    sku,
    barcode,
    initialOnHand,
  };
};

const getFirstOpenWorkshopDateKeyViaBypass = async (
  request,
  role = "MANAGER",
  anchorDateKey = getLondonDateKey(),
) => {
  const visibleStart = getOperationalWeekStartDateKey(anchorDateKey);
  const visibleEnd = addDaysToDateKey(visibleStart, 6);
  const calendar = await apiJsonWithHeaderBypass(
    request,
    "GET",
    `/api/workshop/calendar?from=${encodeURIComponent(visibleStart)}&to=${encodeURIComponent(visibleEnd)}`,
    role,
  );
  const firstOpenDay = Array.isArray(calendar.days)
    ? calendar.days.find((day) => day && day.isClosed === false && typeof day.date === "string")
    : null;

  if (!firstOpenDay?.date) {
    throw new Error(`Expected workshop calendar to expose at least one open day between ${visibleStart} and ${visibleEnd}.`);
  }

  return firstOpenDay.date;
};

const markWebOrderPackedViaBypass = async (request, orderId, role = "MANAGER") =>
  apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/online-store/orders/${encodeURIComponent(orderId)}/packing`,
    role,
    { data: { packed: true } },
  );

const searchOnlineStoreOrders = async (page, query) => {
  const normalizedQuery = query.trim();
  const searchInput = page.getByTestId("online-store-search-orders");
  const existingValue = await searchInput.inputValue();

  if (existingValue === normalizedQuery) {
    await page.getByTestId("online-store-orders-loading").waitFor({ state: "detached" }).catch(() => {});
    return;
  }

  const listResponsePromise = page.waitForResponse((response) => {
    if (!response.ok() || !response.url().includes("/api/online-store/orders?")) {
      return false;
    }

    try {
      const responseUrl = new URL(response.url());
      return (responseUrl.searchParams.get("q") ?? "") === normalizedQuery;
    } catch {
      return false;
    }
  });

  await searchInput.fill(normalizedQuery);
  await listResponsePromise;
  await page.getByTestId("online-store-orders-loading").waitFor({ state: "detached" }).catch(() => {});
};

module.exports = {
  addDaysToDateKey,
  apiJson,
  apiJsonWithHeaderBypass,
  buildHeaderBypassHeaders,
  ensureUserViaAdminBypass,
  getFirstOpenWorkshopDateKeyViaBypass,
  getLondonDateKey,
  getMondayDateKey,
  getOperationalWeekStartDateKey,
  loginViaUi,
  markWebOrderPackedViaBypass,
  parseDateKeyAtNoon,
  searchOnlineStoreOrders,
  seedCatalogVariant,
  uniqueToken,
};
