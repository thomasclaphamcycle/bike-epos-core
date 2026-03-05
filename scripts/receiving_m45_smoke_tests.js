#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const bcrypt = require("bcryptjs");
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
  throw new Error(
    "Refusing to run against non-test database URL. Set TEST_DATABASE_URL or ALLOW_NON_TEST_DB=1.",
  );
}

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[m45-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m45-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const serverIsHealthy = async () => {
  try {
    const response = await fetch(HEALTH_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const apiJson = async ({ path, method = "GET", body, cookie }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return { payload, status: response.status };
};

const login = async (email, password) => {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await parseJson(response);
  assert.equal(response.status, 200, JSON.stringify(payload));

  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "missing set-cookie");
  return setCookie.split(";")[0];
};

let sequence = 0;
const uniqueRef = () => `${Date.now()}_${sequence++}`;

const run = async () => {
  const token = uniqueRef();
  const managerEmail = `m45.manager.${token}@example.com`;
  const managerPassword = `M45Pass!${token}`;

  const created = {
    userId: null,
    locationId: null,
    supplierId: null,
    productId: null,
    variantId: null,
    purchaseOrderId: null,
  };

  let startedServer = false;
  let serverProcess = null;

  try {
    const alreadyHealthy = await serverIsHealthy();
    if (alreadyHealthy && process.env.ALLOW_EXISTING_SERVER !== "1") {
      throw new Error(
        "Refusing to run against an already-running server. Stop it first or set ALLOW_EXISTING_SERVER=1.",
      );
    }

    if (!alreadyHealthy) {
      serverProcess = spawn("npm", ["run", "dev"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL,
        },
      });
      startedServer = true;
      await waitForServer();
    }

    const manager = await prisma.user.create({
      data: {
        username: `m45-manager-${token}`,
        name: "M45 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "MANAGER",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const location = await prisma.stockLocation.create({
      data: {
        name: `M45 Location ${token}`,
        isDefault: true,
      },
    });
    created.locationId = location.id;

    const cookie = await login(managerEmail, managerPassword);

    const supplier = await apiJson({
      path: "/api/suppliers",
      method: "POST",
      body: {
        name: `M45 Supplier ${token}`,
      },
      cookie,
    });
    created.supplierId = supplier.payload.id;

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M45 Product ${token}`,
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: `/api/products/${encodeURIComponent(product.payload.id)}/variants`,
      method: "POST",
      body: {
        sku: `M45-SKU-${token}`,
        name: `M45 Variant ${token}`,
        retailPricePence: 2200,
        costPricePence: 1400,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    const po = await apiJson({
      path: "/api/purchase-orders",
      method: "POST",
      body: {
        supplierId: supplier.payload.id,
        notes: "M45 receive flow",
      },
      cookie,
    });
    created.purchaseOrderId = po.payload.id;

    const poWithLine = await apiJson({
      path: `/api/purchase-orders/${encodeURIComponent(po.payload.id)}/lines`,
      method: "POST",
      body: {
        productId: product.payload.id,
        quantityOrdered: 10,
        unitCost: 14,
      },
      cookie,
    });
    const lineId = poWithLine.payload.lines[0]?.id;
    assert.ok(lineId, "missing purchase order line id");

    const submitted = await apiJson({
      path: `/api/purchase-orders/${encodeURIComponent(po.payload.id)}/submit`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.equal(submitted.payload.status, "SUBMITTED");

    const partialReceipt = await apiJson({
      path: `/api/purchase-orders/${encodeURIComponent(po.payload.id)}/receive`,
      method: "POST",
      body: {
        notes: "M45 partial",
        lines: [
          {
            lineId,
            quantityReceived: 4,
            unitCost: 14,
          },
        ],
      },
      cookie,
    });
    assert.ok(partialReceipt.payload.receipt?.id, JSON.stringify(partialReceipt.payload));
    assert.equal(partialReceipt.payload.purchaseOrder.status, "RECEIVED_PARTIAL");

    const partialOnHand = await apiJson({
      path: `/api/inventory/on-hand?variantId=${encodeURIComponent(variant.payload.id)}`,
      cookie,
    });
    assert.equal(partialOnHand.payload.onHand, 4);

    const finalReceipt = await apiJson({
      path: `/api/purchase-orders/${encodeURIComponent(po.payload.id)}/receive`,
      method: "POST",
      body: {
        notes: "M45 final",
        lines: [
          {
            lineId,
            quantityReceived: 6,
          },
        ],
      },
      cookie,
    });
    assert.ok(finalReceipt.payload.receipt?.id, JSON.stringify(finalReceipt.payload));
    assert.equal(finalReceipt.payload.purchaseOrder.status, "RECEIVED_COMPLETE");

    const finalOnHand = await apiJson({
      path: `/api/inventory/on-hand?variantId=${encodeURIComponent(variant.payload.id)}`,
      cookie,
    });
    assert.equal(finalOnHand.payload.onHand, 10);

    const receiptList = await apiJson({
      path: `/api/purchase-orders/${encodeURIComponent(po.payload.id)}/receipts`,
      cookie,
    });
    assert.equal(Array.isArray(receiptList.payload.receipts), true);
    assert.equal(receiptList.payload.receipts.length, 2);

    const receiptDetail = await apiJson({
      path: `/api/purchase-receipts/${encodeURIComponent(finalReceipt.payload.receipt.id)}`,
      cookie,
    });
    assert.equal(receiptDetail.payload.receipt.id, finalReceipt.payload.receipt.id);
    assert.equal(receiptDetail.payload.receipt.purchaseOrderId, po.payload.id);

    const purchaseReceiptMovements = await prisma.inventoryMovement.findMany({
      where: {
        variantId: variant.payload.id,
        type: "PURCHASE_RECEIPT",
      },
    });
    assert.equal(purchaseReceiptMovements.length, 2);

    const receivingPage = await fetch(`${BASE_URL}/receiving`, {
      headers: {
        Cookie: cookie,
        Accept: "text/html",
      },
    });
    assert.equal(receivingPage.status, 200);
    const receivingHtml = await receivingPage.text();
    assert.ok(receivingHtml.includes("Receiving"));
    assert.ok(receivingHtml.includes('data-testid="receiving-heading"'));

    console.log("M45 goods receiving smoke tests passed.");
  } finally {
    if (created.variantId) {
      await prisma.stockLedgerEntry.deleteMany({ where: { variantId: created.variantId } });
      await prisma.inventoryMovement.deleteMany({ where: { variantId: created.variantId } });
    }

    if (created.purchaseOrderId) {
      const receiptIds = await prisma.purchaseReceipt.findMany({
        where: { purchaseOrderId: created.purchaseOrderId },
        select: { id: true },
      });
      if (receiptIds.length > 0) {
        await prisma.purchaseReceiptLine.deleteMany({
          where: {
            receiptId: {
              in: receiptIds.map((receipt) => receipt.id),
            },
          },
        });
      }
      await prisma.purchaseReceipt.deleteMany({ where: { purchaseOrderId: created.purchaseOrderId } });
      await prisma.purchaseOrder.deleteMany({ where: { id: created.purchaseOrderId } });
    }

    if (created.supplierId) {
      await prisma.supplier.deleteMany({ where: { id: created.supplierId } });
    }

    if (created.variantId) {
      await prisma.barcode.deleteMany({ where: { variantId: created.variantId } });
      await prisma.variant.deleteMany({ where: { id: created.variantId } });
    }

    if (created.productId) {
      await prisma.product.deleteMany({ where: { id: created.productId } });
    }

    if (created.locationId) {
      await prisma.stockLocation.deleteMany({ where: { id: created.locationId } });
    }

    if (created.userId) {
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }

    await prisma.$disconnect();

    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(400);
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
