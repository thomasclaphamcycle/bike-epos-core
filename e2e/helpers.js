const buildAuthHeaders = (role = "STAFF") => {
  const headers = {
    "X-Staff-Role": role,
    "X-Staff-Id": role === "MANAGER" ? "e2e-manager" : "e2e-staff",
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

const apiJson = async (
  request,
  method,
  path,
  options = {},
) => {
  const response = await request.fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(options.role || "STAFF"),
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

let sequence = 0;
const uniqueToken = (prefix = "e2e") => `${prefix}-${Date.now()}-${++sequence}`;

const seedCatalogVariant = async (
  request,
  options = {},
) => {
  const token = uniqueToken(options.prefix || "catalog");
  const product = await apiJson(request, "POST", "/api/products", {
    role: "MANAGER",
    data: {
      name: `E2E Product ${token}`,
      brand: "E2E",
      description: "Playwright seeded product",
    },
  });

  const sku = `E2E-${token.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}`;
  const variant = await apiJson(
    request,
    "POST",
    `/api/products/${encodeURIComponent(product.id)}/variants`,
    {
      role: "MANAGER",
      data: {
        sku,
        name: `E2E Variant ${token}`,
        retailPricePence: options.retailPricePence ?? 1499,
      },
    },
  );

  const initialOnHand = options.initialOnHand ?? 4;
  if (initialOnHand !== 0) {
    await apiJson(request, "POST", "/api/inventory/adjustments", {
      role: "STAFF",
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
  buildAuthHeaders,
  seedCatalogVariant,
  uniqueToken,
};
