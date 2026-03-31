#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const safeDbUrl = DATABASE_URL.replace(
  /(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i,
  "$1***@",
);
console.log(`[m25-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m25-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const uniqueRef = () => `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const serverController = createSmokeServerController({
  label: "m25-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
});

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${serverController.getBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return {
    status: response.status,
    json,
  };
};

const cleanup = async (state) => {
  const variantIds = Array.from(state.variantIds);
  const productIds = Array.from(state.productIds);

  if (variantIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
    await prisma.barcode.deleteMany({
      where: {
        variantId: {
          in: variantIds,
        },
      },
    });
    await prisma.variant.deleteMany({
      where: {
        id: {
          in: variantIds,
        },
      },
    });
  }

  if (productIds.length > 0) {
    await prisma.product.deleteMany({
      where: {
        id: {
          in: productIds,
        },
      },
    });
  }
};

const run = async () => {
  const state = {
    productIds: new Set(),
    variantIds: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const managerHeaders = {
      "X-Staff-Role": "MANAGER",
      "X-Staff-Id": "m25-smoke-manager",
    };
    const staffHeaders = {
      "X-Staff-Role": "STAFF",
      "X-Staff-Id": "m25-smoke-staff",
    };

    const blockedProductRes = await fetchJson("/api/products", {
      method: "POST",
      headers: staffHeaders,
      body: JSON.stringify({
        name: `M25 Blocked Product ${uniqueRef()}`,
      }),
    });
    assert.equal(blockedProductRes.status, 403, JSON.stringify(blockedProductRes.json));

    const createProductRes = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M25 Product ${uniqueRef()}`,
        brand: "M25 Brand",
      }),
    });
    assert.equal(createProductRes.status, 201, JSON.stringify(createProductRes.json));
    const productId = createProductRes.json.id;
    state.productIds.add(productId);

    const sku = `M25-SKU-${uniqueRef()}`;
    const createVariantRes = await fetchJson(`/api/products/${productId}/variants`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        sku,
        retailPrice: "19.99",
        isActive: true,
      }),
    });
    assert.equal(createVariantRes.status, 201, JSON.stringify(createVariantRes.json));
    assert.equal(createVariantRes.json.sku, sku);
    assert.equal(createVariantRes.json.retailPrice, "19.99");
    assert.equal(createVariantRes.json.retailPricePence, 1999);
    const variantId = createVariantRes.json.id;
    state.variantIds.add(variantId);

    const searchSkuRes = await fetchJson(`/api/variants?q=${encodeURIComponent(sku)}&active=1`, {
      method: "GET",
      headers: staffHeaders,
    });
    assert.equal(searchSkuRes.status, 200, JSON.stringify(searchSkuRes.json));
    assert.ok(Array.isArray(searchSkuRes.json.variants));
    assert.ok(searchSkuRes.json.variants.some((variant) => variant.id === variantId));

    const searchProductRes = await fetchJson(
      `/api/variants?q=${encodeURIComponent(createProductRes.json.name)}&take=50&skip=0`,
      {
        method: "GET",
        headers: staffHeaders,
      },
    );
    assert.equal(searchProductRes.status, 200, JSON.stringify(searchProductRes.json));
    assert.ok(searchProductRes.json.variants.some((variant) => variant.id === variantId));

    const duplicateSkuRes = await fetchJson(`/api/products/${productId}/variants`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        sku,
        retailPrice: "9.99",
      }),
    });
    assert.equal(duplicateSkuRes.status, 409, JSON.stringify(duplicateSkuRes.json));
    assert.equal(duplicateSkuRes.json?.error?.code, "SKU_EXISTS");

    const newBarcode = `M25BAR${Date.now().toString().slice(-8)}`;
    const patchVariantRes = await fetchJson(`/api/variants/${variantId}`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({
        barcode: newBarcode,
        retailPrice: "21.50",
      }),
    });
    assert.equal(patchVariantRes.status, 200, JSON.stringify(patchVariantRes.json));
    assert.equal(patchVariantRes.json.barcode, newBarcode);
    assert.equal(patchVariantRes.json.retailPricePence, 2150);

    const searchBarcodeRes = await fetchJson(
      `/api/variants?q=${encodeURIComponent(newBarcode)}&active=1`,
      {
        method: "GET",
        headers: staffHeaders,
      },
    );
    assert.equal(searchBarcodeRes.status, 200, JSON.stringify(searchBarcodeRes.json));
    assert.ok(searchBarcodeRes.json.variants.some((variant) => variant.id === variantId));

    const blockedVariantPatchRes = await fetchJson(`/api/variants/${variantId}`, {
      method: "PATCH",
      headers: staffHeaders,
      body: JSON.stringify({
        retailPrice: "23.00",
      }),
    });
    assert.equal(blockedVariantPatchRes.status, 403, JSON.stringify(blockedVariantPatchRes.json));

    console.log("[m25-smoke] PASS");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error("[m25-smoke] FAIL", error);
  process.exitCode = 1;
});
