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

const ensureUserViaAdminBypass = async (
  request,
  options = {},
) => {
  const token = uniqueToken(options.prefix || "user");
  const role = options.role || "MANAGER";
  const email = `${token}@example.com`;
  const password = options.password || `Playwright!${token}`;
  const name = options.name || `${role} ${token}`;

  const payload = await apiJsonWithHeaderBypass(request, "POST", "/api/admin/users", "ADMIN", {
    data: {
      name,
      email,
      role,
      tempPassword: password,
    },
  });

  return {
    user: payload.user,
    email,
    password,
  };
};

const loginViaUi = async (page, credentials, nextPath = "/pos") => {
  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await page.fill('[data-testid="login-email"]', credentials.email);
  await page.fill('[data-testid="login-password"]', credentials.password);
  await page.click('[data-testid="login-submit"]');
  await page.waitForURL(new RegExp(`${nextPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
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
  const variant = await apiJsonWithHeaderBypass(
    request,
    "POST",
    `/api/products/${encodeURIComponent(product.id)}/variants`,
    "MANAGER",
    {
      data: {
        sku,
        name: `E2E Variant ${token}`,
        retailPricePence: options.retailPricePence ?? 1499,
      },
    },
  );

  const initialOnHand = options.initialOnHand ?? 4;
  if (initialOnHand !== 0) {
    await apiJsonWithHeaderBypass(request, "POST", "/api/inventory/adjustments", "STAFF", {
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
    initialOnHand,
  };
};

module.exports = {
  apiJson,
  apiJsonWithHeaderBypass,
  buildHeaderBypassHeaders,
  ensureUserViaAdminBypass,
  loginViaUi,
  seedCatalogVariant,
  uniqueToken,
};
