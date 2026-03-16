#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
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

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const appBaseUrlCandidates = (() => {
  const primary = new URL(BASE_URL).toString().replace(/\/$/, "");
  const urls = [primary];

  try {
    const fallback = new URL(primary);
    if (fallback.hostname === "localhost") {
      fallback.hostname = "127.0.0.1";
      urls.push(fallback.toString().replace(/\/$/, ""));
    }
  } catch {
    // Ignore malformed URL handling here; the primary URL will surface the failure.
  }

  return urls;
})();

const serverController = createSmokeServerController({
  label: "m76-smoke",
  baseUrls: appBaseUrlCandidates,
  databaseUrl: DATABASE_URL,
  captureStartupLog: true,
  startupReadyPattern: /Server running on http:\/\/localhost:\d+/i,
});

const parseJson = async (response) => {
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

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${serverController.getBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  return {
    status: response.status,
    json: await parseJson(response),
  };
};

const run = async () => {
  const ref = uniqueRef();
  const managerHeaders = {
    "X-Staff-Role": "MANAGER",
    "X-Staff-Id": `m76-manager-${ref}`,
  };
  const staffHeaders = {
    "X-Staff-Role": "STAFF",
    "X-Staff-Id": `m76-staff-${ref}`,
  };

  const created = {
    productId: null,
    variantId: null,
    userIds: [managerHeaders["X-Staff-Id"], staffHeaders["X-Staff-Id"]],
  };

  try {
    await serverController.startIfNeeded();

    const product = await fetchJson("/api/products", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `M76 Product ${ref}`,
        brand: "M76",
      }),
    });
    assert.equal(product.status, 201, JSON.stringify(product.json));
    created.productId = product.json.id;

    const barcode = `760${String(Date.now()).slice(-10)}`;
    const variant = await fetchJson(`/api/products/${created.productId}/variants`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        sku: `M76-SKU-${ref}`,
        name: `M76 Variant ${ref}`,
        barcode,
        retailPricePence: 2199,
      }),
    });
    assert.equal(variant.status, 201, JSON.stringify(variant.json));
    created.variantId = variant.json.id;

    const adjustment = await fetchJson("/api/inventory/adjustments", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        variantId: created.variantId,
        quantityDelta: 7,
        reason: "COUNT_CORRECTION",
        note: "m76 barcode seed",
      }),
    });
    assert.equal(adjustment.status, 201, JSON.stringify(adjustment.json));

    const lookup = await fetchJson(`/api/products/barcode/${encodeURIComponent(barcode)}`, {
      headers: staffHeaders,
    });
    assert.equal(lookup.status, 200, JSON.stringify(lookup.json));
    assert.equal(lookup.json.row.id, created.variantId);
    assert.equal(lookup.json.row.barcode, barcode);
    assert.equal(lookup.json.row.onHandQty, 7);

    const unknown = await fetchJson("/api/products/barcode/0000000000000", {
      headers: staffHeaders,
    });
    assert.equal(unknown.status, 404, JSON.stringify(unknown.json));

    console.log("M76 barcode POS smoke tests passed.");
  } finally {
    if (created.variantId) {
      await prisma.inventoryMovement.deleteMany({ where: { variantId: created.variantId } });
      await prisma.stockLedgerEntry.deleteMany({ where: { variantId: created.variantId } });
      await prisma.barcode.deleteMany({ where: { variantId: created.variantId } });
      await prisma.variant.deleteMany({ where: { id: created.variantId } });
    }

    if (created.productId) {
      await prisma.product.deleteMany({ where: { id: created.productId } });
    }

    if (created.userIds.length > 0) {
      await prisma.user.deleteMany({
        where: {
          id: {
            in: created.userIds,
          },
        },
      });
    }

    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
