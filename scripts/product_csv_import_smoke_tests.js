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
const RUN_REF = `${Date.now()}`;
const MANAGER_ID = `product-import-manager-${RUN_REF}`;
const MANAGER_HEADERS = {
  "Content-Type": "application/json",
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": MANAGER_ID,
};

const fetchJson = async (path, init = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, init);
  const json = await response.json();
  return { status: response.status, json };
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await serverIsHealthy()) {
      return;
    }
    await sleep(500);
  }
  throw new Error("Server did not become healthy on /health");
};

const cleanup = async (state) => {
  if (state.variantIds.length) {
    await prisma.inventoryMovement.deleteMany({
      where: {
        variantId: {
          in: state.variantIds,
        },
      },
    });
    await prisma.stockLedgerEntry.deleteMany({
      where: {
        variantId: {
          in: state.variantIds,
        },
      },
    });
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

  if (state.userIds.length) {
    await prisma.user.deleteMany({
      where: {
        id: {
          in: state.userIds,
        },
      },
    });
  }
};

const main = async () => {
  const state = {
    productIds: [],
    variantIds: [],
    userIds: [MANAGER_ID],
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
      startedServer = true;
      await waitForServer();
    }

    const existingProduct = await prisma.product.create({
      data: {
        name: `Existing Import Product ${RUN_REF}`,
        category: "Components",
        variants: {
          create: {
            sku: `CSV-EXISTING-${RUN_REF}`,
            barcode: `77${RUN_REF.slice(-10)}`,
            retailPrice: "9.99",
            retailPricePence: 999,
            costPricePence: 400,
          },
        },
      },
      include: {
        variants: true,
      },
    });
    state.productIds.push(existingProduct.id);
    state.variantIds.push(existingProduct.variants[0].id);

    const validSku = `CSV-VALID-${RUN_REF}`;
    const warningSku = `CSV-WARN-${RUN_REF}`;
    const warningBarcode = `88${RUN_REF.slice(-10)}`;
    const staleCsv = [
      "name,sku,barcode,retail price,cost,stock quantity,category,notes",
      `Imported Tyre,${validSku},${warningBarcode},34.99,18.50,6,Tyres,unknown-column-warning`,
      `Imported Tube,${warningSku},,6.99,,4,Inner Tubes,warning-row`,
      `Conflict Row,${existingProduct.variants[0].sku},99${RUN_REF.slice(-10)},9.99,4.00,0,Components,existing-sku`,
      `Bad Price,BAD-${RUN_REF},66${RUN_REF.slice(-10)},9.999,4.00,0,Components,invalid-retail`,
    ].join("\n");

    const preview = await fetchJson("/api/products/import/preview", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        csvText: staleCsv,
      }),
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.json));
    assert.equal(preview.json.summary.totalRows, 4);
    assert.equal(preview.json.summary.eligibleRows, 2);
    assert.equal(preview.json.summary.errorRows, 2);
    assert.equal(preview.json.summary.warningRows, 1);
    assert.ok(preview.json.fileWarnings.some((warning) => warning.includes("Unknown columns ignored")));
    const validPreviewRow = preview.json.items.find((row) => row.parsed.sku === validSku);
    assert.ok(validPreviewRow, JSON.stringify(preview.json));
    assert.equal(validPreviewRow.isEligible, true);
    assert.equal(validPreviewRow.parsed.stockQuantity, 6);
    const warningPreviewRow = preview.json.items.find((row) => row.parsed.sku === warningSku);
    assert.ok(warningPreviewRow, JSON.stringify(preview.json));
    assert.equal(warningPreviewRow.isEligible, true);
    assert.ok(warningPreviewRow.warnings.some((warning) => warning.includes("Cost is missing")));
    const conflictPreviewRow = preview.json.items.find((row) => row.parsed.sku === existingProduct.variants[0].sku);
    assert.ok(conflictPreviewRow, JSON.stringify(preview.json));
    assert.ok(conflictPreviewRow.errors.some((issue) => issue.includes("SKU already exists")));

    const staleConfirm = await fetchJson("/api/products/import/confirm", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        csvText: staleCsv,
        previewKey: "stale-preview-key",
      }),
    });
    assert.equal(staleConfirm.status, 409, JSON.stringify(staleConfirm.json));

    const confirm = await fetchJson("/api/products/import/confirm", {
      method: "POST",
      headers: MANAGER_HEADERS,
      body: JSON.stringify({
        csvText: staleCsv,
        previewKey: preview.json.previewKey,
      }),
    });
    assert.equal(confirm.status, 201, JSON.stringify(confirm.json));
    assert.equal(confirm.json.summary.importedRows, 2);
    assert.equal(confirm.json.summary.failedRows, 0);
    assert.equal(confirm.json.summary.skippedRows, 2);

    const importedVariants = await prisma.variant.findMany({
      where: {
        sku: {
          in: [validSku, warningSku],
        },
      },
      include: {
        product: true,
      },
      orderBy: {
        sku: "asc",
      },
    });
    assert.equal(importedVariants.length, 2);
    importedVariants.forEach((variant) => {
      state.variantIds.push(variant.id);
      state.productIds.push(variant.productId);
    });

    const importedTyre = importedVariants.find((variant) => variant.sku === validSku);
    assert.ok(importedTyre);
    assert.equal(importedTyre.product.name, "Imported Tyre");
    assert.equal(importedTyre.costPricePence, 1850);

    const importedTube = importedVariants.find((variant) => variant.sku === warningSku);
    assert.ok(importedTube);
    assert.equal(importedTube.costPricePence, null);
    assert.equal(importedTube.barcode, null);

    const groupedInventory = await prisma.inventoryMovement.groupBy({
      by: ["variantId"],
      where: {
        variantId: {
          in: importedVariants.map((variant) => variant.id),
        },
      },
      _sum: {
        quantity: true,
      },
    });
    const quantityByVariantId = new Map(
      groupedInventory.map((row) => [row.variantId, row._sum.quantity ?? 0]),
    );
    assert.equal(quantityByVariantId.get(importedTyre.id), 6);
    assert.equal(quantityByVariantId.get(importedTube.id), 4);

    const importedSearch = await fetchJson(`/api/inventory/on-hand/search?q=${encodeURIComponent(validSku)}`, {
      headers: MANAGER_HEADERS,
    });
    assert.equal(importedSearch.status, 200, JSON.stringify(importedSearch.json));
    const searchRow = importedSearch.json.rows.find((row) => row.sku === validSku);
    assert.ok(searchRow, JSON.stringify(importedSearch.json));
    assert.equal(searchRow.onHand, 6);

    console.log("[product-import-smoke] product csv import preview and confirm passed");
  } finally {
    await cleanup(state);
    await prisma.$disconnect();
    if (startedServer && serverProcess) {
      serverProcess.kill("SIGTERM");
    }
  }
};

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
