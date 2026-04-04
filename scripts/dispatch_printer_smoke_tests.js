#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3100";
const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

const ADMIN_HEADERS = {
  "X-Staff-Role": "ADMIN",
  "X-Staff-Id": "dispatch-printer-admin",
};

const MANAGER_HEADERS = {
  "X-Staff-Role": "MANAGER",
  "X-Staff-Id": "dispatch-printer-manager",
};

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

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { status: response.status, json };
};

const run = async () => {
  const serverController = createSmokeServerController({
    label: "dispatch-printer-smoke",
    baseUrl: BASE_URL,
    databaseUrl: DATABASE_URL,
  });
  const createdPrinterIds = [];

  try {
    await serverController.startIfNeeded();

    const initialList = await fetchJson("/api/settings/printers", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(initialList.status, 200, JSON.stringify(initialList.json));
    assert.equal(Array.isArray(initialList.json.printers), true);

    const createDryRunPrinterRes = await fetchJson("/api/settings/printers", {
      method: "POST",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Dispatch Zebra GK420d",
        key: "DISPATCH_ZEBRA_GK420D",
        transportMode: "DRY_RUN",
        location: "Packing bench",
        notes: "Primary shipping-label printer",
      }),
    });
    assert.equal(createDryRunPrinterRes.status, 201, JSON.stringify(createDryRunPrinterRes.json));
    const dryRunPrinterId = createDryRunPrinterRes.json.printer.id;
    createdPrinterIds.push(dryRunPrinterId);
    assert.equal(createDryRunPrinterRes.json.printer.transportMode, "DRY_RUN");
    assert.equal(createDryRunPrinterRes.json.printer.supportsShippingLabels, true);
    assert.equal(createDryRunPrinterRes.json.printer.isDefaultShippingLabelPrinter, false);

    const filteredList = await fetchJson("/api/settings/printers?activeOnly=true&shippingLabelOnly=true", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(filteredList.status, 200, JSON.stringify(filteredList.json));
    assert.equal(filteredList.json.printers.some((printer) => printer.id === dryRunPrinterId), true);

    const setDefaultRes = await fetchJson("/api/settings/printers/default-shipping-label", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: dryRunPrinterId,
      }),
    });
    assert.equal(setDefaultRes.status, 200, JSON.stringify(setDefaultRes.json));
    assert.equal(setDefaultRes.json.defaultShippingLabelPrinterId, dryRunPrinterId);

    const createRawTcpWithoutHostRes = await fetchJson("/api/settings/printers", {
      method: "POST",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Broken RAW_TCP Printer",
        key: "BROKEN_RAW_TCP",
        transportMode: "RAW_TCP",
      }),
    });
    assert.equal(createRawTcpWithoutHostRes.status, 400, JSON.stringify(createRawTcpWithoutHostRes.json));
    assert.equal(createRawTcpWithoutHostRes.json.error.code, "INVALID_PRINTER");

    const createNonShippingPrinterRes = await fetchJson("/api/settings/printers", {
      method: "POST",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Back Office Test Printer",
        key: "BACK_OFFICE_TEST",
        transportMode: "DRY_RUN",
        supportsShippingLabels: false,
      }),
    });
    assert.equal(createNonShippingPrinterRes.status, 201, JSON.stringify(createNonShippingPrinterRes.json));
    const nonShippingPrinterId = createNonShippingPrinterRes.json.printer.id;
    createdPrinterIds.push(nonShippingPrinterId);

    const setNonShippingDefaultRes = await fetchJson("/api/settings/printers/default-shipping-label", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: nonShippingPrinterId,
      }),
    });
    assert.equal(setNonShippingDefaultRes.status, 409, JSON.stringify(setNonShippingDefaultRes.json));
    assert.equal(setNonShippingDefaultRes.json.error.code, "PRINTER_NOT_SHIPPING_LABEL_CAPABLE");

    const deactivateDefaultRes = await fetchJson(`/api/settings/printers/${encodeURIComponent(dryRunPrinterId)}`, {
      method: "PATCH",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        isActive: false,
      }),
    });
    assert.equal(deactivateDefaultRes.status, 200, JSON.stringify(deactivateDefaultRes.json));
    assert.equal(deactivateDefaultRes.json.printer.isActive, false);
    assert.equal(deactivateDefaultRes.json.defaultShippingLabelPrinterId, null);

    const clearDefaultRes = await fetchJson("/api/settings/printers/default-shipping-label", {
      method: "PUT",
      headers: {
        ...ADMIN_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        printerId: null,
      }),
    });
    assert.equal(clearDefaultRes.status, 200, JSON.stringify(clearDefaultRes.json));
    assert.equal(clearDefaultRes.json.defaultShippingLabelPrinterId, null);

    const activeShippingPrintersRes = await fetchJson("/api/settings/printers?activeOnly=true&shippingLabelOnly=true", {
      headers: MANAGER_HEADERS,
    });
    assert.equal(activeShippingPrintersRes.status, 200, JSON.stringify(activeShippingPrintersRes.json));
    assert.equal(activeShippingPrintersRes.json.printers.some((printer) => printer.id === dryRunPrinterId), false);
    assert.equal(activeShippingPrintersRes.json.printers.some((printer) => printer.id === nonShippingPrinterId), false);

    console.log("dispatch printer registration and default selection passed");
  } finally {
    if (createdPrinterIds.length > 0) {
      await prisma.printer.deleteMany({
        where: {
          id: {
            in: createdPrinterIds,
          },
        },
      });
    }
    await prisma.appConfig.deleteMany({
      where: {
        key: "dispatch.defaultShippingLabelPrinterId",
      },
    });

    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
