#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const HEALTH_URL = `${BASE_URL}/health`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}
if (process.env.ALLOW_NON_TEST_DB !== "1" && !DATABASE_URL.toLowerCase().includes("test")) {
  throw new Error("Refusing to run against non-test database URL.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, {
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

  return { status: response.status, json };
};

const managerHeaders = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": `supplier-link-manager-${uniqueRef()}`,
};

const staffHeaders = {
  "X-Staff-Role": "STAFF",
  "X-Staff-Id": `supplier-link-staff-${uniqueRef()}`,
};

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const cleanup = async (state) => {
  if (state.purchaseOrderIds.length) {
    await prisma.purchaseOrderItem.deleteMany({
      where: {
        purchaseOrderId: {
          in: state.purchaseOrderIds,
        },
      },
    });
    await prisma.purchaseOrder.deleteMany({
      where: {
        id: {
          in: state.purchaseOrderIds,
        },
      },
    });
  }

  if (state.linkIds.length) {
    await prisma.supplierProductLink.deleteMany({
      where: {
        id: {
          in: state.linkIds,
        },
      },
    });
  }

  if (state.supplierIds.length) {
    await prisma.supplier.deleteMany({
      where: {
        id: {
          in: state.supplierIds,
        },
      },
    });
  }

  if (state.variantIds.length) {
    await prisma.barcode.deleteMany({
      where: {
        variantId: {
          in: state.variantIds,
        },
      },
    });
    await prisma.variant.deleteMany({
      where: {
        id: {
          in: state.variantIds,
        },
      },
    });
  }

  if (state.productIds.length) {
    await prisma.product.deleteMany({
      where: {
        id: {
          in: state.productIds,
        },
      },
    });
  }
};

const run = async () => {
  const state = {
    productIds: [],
    variantIds: [],
    supplierIds: [],
    linkIds: [],
    purchaseOrderIds: [],
  };
  let startedServer = false;
  let serverProcess = null;

  try {
    const existing = await serverIsHealthy();
    if (existing && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!existing) {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
        },
      });
      serverProcess.stdout.on("data", () => {});
      serverProcess.stderr.on("data", () => {});
      startedServer = true;
      await waitForServer();
    }

    const product = await prisma.product.create({
      data: {
        name: `Supplier Link Product ${uniqueRef()}`,
        category: "Components",
        variants: {
          create: {
            sku: `SUP-LINK-${uniqueRef()}`,
            barcode: `91${Date.now().toString().slice(-10)}`,
            retailPrice: "12.99",
            retailPricePence: 1299,
            costPricePence: 499,
          },
        },
      },
      include: {
        variants: true,
      },
    });
    state.productIds.push(product.id);
    state.variantIds.push(product.variants[0].id);

    const supplierAResponse = await fetchJson("/api/suppliers", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `Link Supplier A ${uniqueRef()}`,
      }),
    });
    assert.equal(supplierAResponse.status, 201, JSON.stringify(supplierAResponse.json));
    state.supplierIds.push(supplierAResponse.json.id);

    const supplierBResponse = await fetchJson("/api/suppliers", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        name: `Link Supplier B ${uniqueRef()}`,
      }),
    });
    assert.equal(supplierBResponse.status, 201, JSON.stringify(supplierBResponse.json));
    state.supplierIds.push(supplierBResponse.json.id);

    const createLinkA = await fetchJson("/api/supplier-product-links", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        supplierId: supplierAResponse.json.id,
        variantId: product.variants[0].id,
        supplierProductCode: "SUP-A-001",
        supplierCostPence: 425,
        preferredSupplier: true,
        isActive: true,
      }),
    });
    assert.equal(createLinkA.status, 201, JSON.stringify(createLinkA.json));
    state.linkIds.push(createLinkA.json.id);
    assert.equal(createLinkA.json.preferredSupplier, true);

    const createLinkB = await fetchJson("/api/supplier-product-links", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        supplierId: supplierBResponse.json.id,
        variantId: product.variants[0].id,
        supplierProductCode: "SUP-B-001",
        supplierCostPence: 455,
        preferredSupplier: true,
        isActive: true,
      }),
    });
    assert.equal(createLinkB.status, 201, JSON.stringify(createLinkB.json));
    state.linkIds.push(createLinkB.json.id);
    assert.equal(createLinkB.json.preferredSupplier, true);

    const variantScopedList = await fetchJson(
      `/api/supplier-product-links?variantId=${encodeURIComponent(product.variants[0].id)}&take=10&skip=0`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(variantScopedList.status, 200, JSON.stringify(variantScopedList.json));
    assert.equal(variantScopedList.json.supplierProductLinks.length, 2);
    const supplierAListRow = variantScopedList.json.supplierProductLinks.find(
      (row) => row.supplierId === supplierAResponse.json.id,
    );
    const supplierBListRow = variantScopedList.json.supplierProductLinks.find(
      (row) => row.supplierId === supplierBResponse.json.id,
    );
    assert.ok(supplierAListRow, JSON.stringify(variantScopedList.json));
    assert.ok(supplierBListRow, JSON.stringify(variantScopedList.json));
    assert.equal(supplierAListRow.preferredSupplier, false);
    assert.equal(supplierBListRow.preferredSupplier, true);

    const updateLinkA = await fetchJson(`/api/supplier-product-links/${createLinkA.json.id}`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({
        supplierProductCode: "SUP-A-002",
        supplierCostPence: 430,
        preferredSupplier: false,
        isActive: true,
      }),
    });
    assert.equal(updateLinkA.status, 200, JSON.stringify(updateLinkA.json));
    assert.equal(updateLinkA.json.supplierProductCode, "SUP-A-002");
    assert.equal(updateLinkA.json.supplierCostPence, 430);

    const createPoWithLink = await fetchJson("/api/purchase-orders", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        supplierId: supplierAResponse.json.id,
        notes: "Supplier link fallback PO",
      }),
    });
    assert.equal(createPoWithLink.status, 201, JSON.stringify(createPoWithLink.json));
    state.purchaseOrderIds.push(createPoWithLink.json.id);

    const addLinkedItem = await fetchJson(`/api/purchase-orders/${createPoWithLink.json.id}/items`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        lines: [
          {
            variantId: product.variants[0].id,
            quantityOrdered: 5,
          },
        ],
      }),
    });
    assert.equal(addLinkedItem.status, 200, JSON.stringify(addLinkedItem.json));
    assert.equal(addLinkedItem.json.items.length, 1);
    assert.equal(addLinkedItem.json.items[0].unitCostPence, 430);

    const deactivateLinkA = await fetchJson(`/api/supplier-product-links/${createLinkA.json.id}`, {
      method: "PATCH",
      headers: managerHeaders,
      body: JSON.stringify({
        isActive: false,
      }),
    });
    assert.equal(deactivateLinkA.status, 200, JSON.stringify(deactivateLinkA.json));
    assert.equal(deactivateLinkA.json.isActive, false);
    assert.equal(deactivateLinkA.json.preferredSupplier, false);

    const createPoWithoutActiveLink = await fetchJson("/api/purchase-orders", {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        supplierId: supplierAResponse.json.id,
        notes: "Variant cost fallback PO",
      }),
    });
    assert.equal(createPoWithoutActiveLink.status, 201, JSON.stringify(createPoWithoutActiveLink.json));
    state.purchaseOrderIds.push(createPoWithoutActiveLink.json.id);

    const addUnlinkedItem = await fetchJson(`/api/purchase-orders/${createPoWithoutActiveLink.json.id}/items`, {
      method: "POST",
      headers: managerHeaders,
      body: JSON.stringify({
        lines: [
          {
            variantId: product.variants[0].id,
            quantityOrdered: 2,
          },
        ],
      }),
    });
    assert.equal(addUnlinkedItem.status, 200, JSON.stringify(addUnlinkedItem.json));
    assert.equal(addUnlinkedItem.json.items.length, 1);
    assert.equal(addUnlinkedItem.json.items[0].unitCostPence, 499);

    const supplierScopedList = await fetchJson(
      `/api/supplier-product-links?supplierId=${encodeURIComponent(supplierAResponse.json.id)}&take=10&skip=0`,
      {
        headers: staffHeaders,
      },
    );
    assert.equal(supplierScopedList.status, 200, JSON.stringify(supplierScopedList.json));
    assert.equal(supplierScopedList.json.supplierProductLinks.length, 1);
    assert.equal(supplierScopedList.json.supplierProductLinks[0].isActive, false);

    console.log("[supplier-link-smoke] supplier product linking groundwork passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
    }
  }
};

run().catch((error) => {
  console.error("[supplier-link-smoke] FAIL", error);
  process.exitCode = 1;
});
