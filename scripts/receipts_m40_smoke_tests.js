#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { register } = require("ts-node");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createSmokeServerController } = require("./smoke_server_helper");

register({ transpileOnly: true });

const { startPrintAgentServer } = require(path.join(__dirname, "..", "print-agent", "src", "app.ts"));

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

const safeDbUrl = DATABASE_URL.replace(/(postgres(?:ql)?:\/\/[^:/@]+:)[^@]+@/i, "$1***@");
console.log(`[m40-smoke] BASE_URL=${BASE_URL}`);
console.log(`[m40-smoke] DATABASE_URL=${safeDbUrl}`);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});
const serverController = createSmokeServerController({
  label: "m40-smoke",
  baseUrl: BASE_URL,
  databaseUrl: DATABASE_URL,
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForPrintJobTerminalState = async (jobId, cookie, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const jobResponse = await apiJson({
      path: `/api/print-jobs/${encodeURIComponent(jobId)}`,
      cookie,
    });
    if (
      jobResponse.payload.job.status === "SUCCEEDED"
      || jobResponse.payload.job.status === "FAILED"
      || jobResponse.payload.job.status === "CANCELLED"
    ) {
      return jobResponse.payload.job;
    }
    await sleep(150);
  }

  throw new Error(`Timed out waiting for print job ${jobId} to reach a terminal state.`);
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
const STORE_LOGO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=";

const run = async () => {
  const token = uniqueRef();
  const managerEmail = `m40.manager.${token}@example.com`;
  const managerPassword = `M40Pass!${token}`;

  const created = {
    userId: null,
    productId: null,
    variantId: null,
    printerIds: new Set(),
    printJobIds: new Set(),
    basketIds: new Set(),
    saleIds: new Set(),
    paymentIds: new Set(),
    refundIds: new Set(),
    receiptNumbers: new Set(),
    storeLogoPaths: new Set(),
  };

  try {
    await serverController.startIfNeeded();

    const manager = await prisma.user.create({
      data: {
        username: `m40-manager-${token}`,
        name: "M40 Manager",
        email: managerEmail,
        passwordHash: await bcrypt.hash(managerPassword, 10),
        role: "ADMIN",
        isActive: true,
      },
    });
    created.userId = manager.id;

    const cookie = await login(managerEmail, managerPassword);

    const product = await apiJson({
      path: "/api/products",
      method: "POST",
      body: {
        name: `M40 Product ${token}`,
        brand: "M40",
      },
      cookie,
    });
    created.productId = product.payload.id;

    const variant = await apiJson({
      path: `/api/products/${encodeURIComponent(product.payload.id)}/variants`,
      method: "POST",
      body: {
        sku: `M40-SKU-${token}`,
        name: `M40 Variant ${token}`,
        retailPricePence: 1500,
      },
      cookie,
    });
    created.variantId = variant.payload.id;

    const customer = await apiJson({
      path: "/api/customers",
      method: "POST",
      body: {
        name: `M40 Customer ${token}`,
        email: `m40.customer.${token}@example.com`,
      },
      cookie,
    });

    await apiJson({
      path: "/api/inventory/adjustments",
      method: "POST",
      body: {
        variantId: created.variantId,
        quantityDelta: 20,
        reason: "COUNT_CORRECTION",
        note: "m40 seed",
      },
      cookie,
    });

    const createSaleViaBasket = async (checkoutBody = {}) => {
      const basket = await apiJson({
        path: "/api/baskets",
        method: "POST",
        body: {},
        cookie,
      });
      created.basketIds.add(basket.payload.id);

      await apiJson({
        path: `/api/baskets/${encodeURIComponent(basket.payload.id)}/lines`,
        method: "POST",
        body: {
          variantId: created.variantId,
          quantity: 1,
        },
        cookie,
      });

      const checkout = await apiJson({
        path: `/api/baskets/${encodeURIComponent(basket.payload.id)}/checkout`,
        method: "POST",
        body: checkoutBody,
        cookie,
      });

      const saleId = checkout.payload.sale?.id;
      assert.ok(saleId, "missing sale id");
      created.saleIds.add(saleId);
      if (checkout.payload.payment?.id) {
        created.paymentIds.add(checkout.payload.payment.id);
      }
      return checkout.payload;
    };

    const tenderSale = await createSaleViaBasket({});
    await apiJson({
      path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/customer`,
      method: "PATCH",
      body: {
        customerId: customer.payload.id,
      },
      cookie,
    });

    await apiJson({
      path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/tenders`,
      method: "POST",
      body: {
        method: "CARD",
        amountPence: tenderSale.sale.totalPence,
      },
      cookie,
    });

    const completion = await apiJson({
      path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/complete`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.ok(completion.payload.completedAt);

    const issuedSale = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        saleId: tenderSale.sale.id,
      },
      cookie,
    });
    assert.equal(issuedSale.status, 201, JSON.stringify(issuedSale.payload));
    assert.ok(issuedSale.payload.receipt?.receiptNumber);
    created.receiptNumbers.add(issuedSale.payload.receipt.receiptNumber);

    const issuedSaleAgain = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        saleId: tenderSale.sale.id,
      },
      cookie,
    });
    assert.equal(issuedSaleAgain.status, 200, JSON.stringify(issuedSaleAgain.payload));
    assert.equal(issuedSaleAgain.payload.idempotent, true);
    assert.equal(
      issuedSaleAgain.payload.receipt.receiptNumber,
      issuedSale.payload.receipt.receiptNumber,
    );

    const externalLogoUrl = `https://cdn.corepos.local/logo-${token}.png`;
    await prisma.appConfig.upsert({
      where: { key: "store.logoUrl" },
      create: {
        key: "store.logoUrl",
        value: externalLogoUrl,
      },
      update: {
        value: externalLogoUrl,
      },
    });

    const storeLogoDir = path.join(process.cwd(), "uploads", "store-logos");
    await fs.mkdir(storeLogoDir, { recursive: true });
    const uploadedLogoFilename = `m40-store-logo-${token}.png`;
    const uploadedLogoPublicPath = `/uploads/store-logos/${uploadedLogoFilename}`;
    await fs.writeFile(
      path.join(storeLogoDir, uploadedLogoFilename),
      Buffer.from(STORE_LOGO_PNG_BASE64, "base64"),
    );
    created.storeLogoPaths.add(uploadedLogoPublicPath);

    await prisma.appConfig.upsert({
      where: { key: "store.uploadedLogoPath" },
      create: {
        key: "store.uploadedLogoPath",
        value: uploadedLogoPublicPath,
      },
      update: {
        value: uploadedLogoPublicPath,
      },
    });

    const saleReceipt = await apiJson({
      path: `/api/receipts/${encodeURIComponent(issuedSale.payload.receipt.receiptNumber)}`,
      cookie,
    });
    assert.equal(saleReceipt.payload.type, "SALE");
    assert.equal(saleReceipt.payload.saleId, tenderSale.sale.id);
    assert.equal(Array.isArray(saleReceipt.payload.items), true);
    assert.equal(Array.isArray(saleReceipt.payload.tenders), true);
    assert.equal(saleReceipt.payload.totals.totalPence, tenderSale.sale.totalPence);
    assert.equal(saleReceipt.payload.shop.logoUrl, externalLogoUrl);
    assert.equal(saleReceipt.payload.shop.uploadedLogoPath, uploadedLogoPublicPath);
    assert.equal(saleReceipt.payload.shop.preferredLogoUrl, uploadedLogoPublicPath);

    const printable = await fetch(
      `${BASE_URL}/r/${encodeURIComponent(issuedSale.payload.receipt.receiptNumber)}`,
      {
        headers: { Cookie: cookie },
      },
    );
    assert.equal(printable.status, 200);
    const printableHtml = await printable.text();
    assert.ok(printableHtml.includes("Print"));
    assert.ok(printableHtml.includes(issuedSale.payload.receipt.receiptNumber));
    assert.ok(printableHtml.includes(uploadedLogoPublicPath));

    await prisma.appConfig.upsert({
      where: { key: "store.uploadedLogoPath" },
      create: {
        key: "store.uploadedLogoPath",
        value: "",
      },
      update: {
        value: "",
      },
    });

    const fallbackReceipt = await apiJson({
      path: `/api/receipts/${encodeURIComponent(issuedSale.payload.receipt.receiptNumber)}`,
      cookie,
    });
    assert.equal(fallbackReceipt.payload.shop.logoUrl, externalLogoUrl);
    assert.equal(fallbackReceipt.payload.shop.uploadedLogoPath, "");
    assert.equal(fallbackReceipt.payload.shop.preferredLogoUrl, externalLogoUrl);

    const fallbackPrintable = await fetch(
      `${BASE_URL}/r/${encodeURIComponent(issuedSale.payload.receipt.receiptNumber)}`,
      {
        headers: { Cookie: cookie },
      },
    );
    assert.equal(fallbackPrintable.status, 200);
    const fallbackPrintableHtml = await fallbackPrintable.text();
    assert.ok(fallbackPrintableHtml.includes(externalLogoUrl));

    const legacySaleReceipt = await apiJson({
      path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/receipt`,
      cookie,
    });
    assert.equal(legacySaleReceipt.payload.saleId, tenderSale.sale.id);
    assert.equal(legacySaleReceipt.payload.customer?.email, customer.payload.email);

    const emailedSaleReceipt = await apiJson({
      path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/receipt/email`,
      method: "POST",
      body: {},
      cookie,
    });
    assert.equal(emailedSaleReceipt.status, 202, JSON.stringify(emailedSaleReceipt.payload));
    assert.equal(emailedSaleReceipt.payload.recipientEmail, customer.payload.email);
    assert.equal(
      emailedSaleReceipt.payload.receiptNumber,
      issuedSale.payload.receipt.receiptNumber,
    );
    assert.ok(
      emailedSaleReceipt.payload.deliveryMode === "log"
      || emailedSaleReceipt.payload.deliveryMode === "smtp",
    );

    const receiptPrintAgent = await startPrintAgentServer({
      bindHost: "127.0.0.1",
      port: 0,
      sharedSecret: "m40-receipt-print-secret",
      dryRunOutputDir: path.resolve(process.cwd(), "tmp", "m40-receipt-print-agent"),
      rawTcpTimeoutMs: 5000,
    });

    try {
      const receiptPrinter = await apiJson({
        path: "/api/settings/printers",
        method: "POST",
        body: {
          name: "M40 Till Receipt Printer",
          key: `M40_TILL_RECEIPT_${token}`.toUpperCase(),
          printerFamily: "THERMAL_RECEIPT",
          transportMode: "DRY_RUN",
          location: "Till",
          notes: "Managed thermal receipt smoke printer",
        },
        cookie,
      });
      const receiptPrinterId = receiptPrinter.payload.printer.id;
      created.printerIds.add(receiptPrinterId);

      await apiJson({
        path: "/api/settings/receipt-print-agent",
        method: "PUT",
        body: {
          url: `http://${receiptPrintAgent.host}:${receiptPrintAgent.port}`,
          sharedSecret: "m40-receipt-print-secret",
        },
        cookie,
      });

      await apiJson({
        path: "/api/settings/receipt-workstations",
        method: "PUT",
        body: {
          workstations: [
            {
              key: "TILL_PC",
              defaultPrinterId: receiptPrinterId,
            },
            {
              key: "WORKSHOP_1",
              defaultPrinterId: null,
            },
            {
              key: "WORKSHOP_2",
              defaultPrinterId: null,
            },
          ],
        },
        cookie,
      });

      const unresolvedPrepare = await apiJson({
        path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/receipt/prepare-print`,
        method: "POST",
        body: {},
        cookie,
      });
      assert.equal(unresolvedPrepare.payload.printer, null);
      assert.equal(unresolvedPrepare.payload.resolutionError?.code, "DEFAULT_RECEIPT_PRINTER_NOT_CONFIGURED");

      const preparedManagedReceipt = await apiJson({
        path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/receipt/prepare-print`,
        method: "POST",
        body: {
          workstationKey: "TILL_PC",
        },
        cookie,
      });
      assert.equal(preparedManagedReceipt.payload.receipt.receiptNumber, issuedSale.payload.receipt.receiptNumber);
      assert.equal(preparedManagedReceipt.payload.currentWorkstation?.key, "TILL_PC");
      assert.equal(preparedManagedReceipt.payload.printer?.id, receiptPrinterId);
      assert.equal(preparedManagedReceipt.payload.printer?.resolutionSource, "workstation");
      assert.equal(preparedManagedReceipt.payload.availablePrinters.length >= 1, true);
      assert.equal(preparedManagedReceipt.payload.browserPrintPath, `/sales/${tenderSale.sale.id}/receipt/print`);

      const managedPrint = await apiJson({
        path: `/api/sales/${encodeURIComponent(tenderSale.sale.id)}/receipt/print`,
        method: "POST",
        body: {
          workstationKey: "TILL_PC",
        },
        cookie,
      });
      assert.equal(managedPrint.status, 202);
      assert.equal(managedPrint.payload.receipt.receiptNumber, issuedSale.payload.receipt.receiptNumber);
      assert.equal(managedPrint.payload.printer.id, receiptPrinterId);
      assert.equal(managedPrint.payload.printer.resolutionSource, "workstation");
      assert.ok(managedPrint.payload.job?.id, "expected managed print job id");
      assert.equal(managedPrint.payload.job.workflowType, "RECEIPT_PRINT");
      assert.equal(managedPrint.payload.job.printerId, receiptPrinterId);
      assert.equal(managedPrint.payload.job.status, "PENDING");
      created.printJobIds.add(managedPrint.payload.job.id);

      const queuedJob = await waitForPrintJobTerminalState(managedPrint.payload.job.id, cookie);
      assert.equal(queuedJob.status, "SUCCEEDED");
      assert.equal(queuedJob.printerId, receiptPrinterId);
      assert.equal(queuedJob.attemptCount, 1);
      assert.equal(queuedJob.lastError, null);
    } finally {
      await receiptPrintAgent.close();
    }

    const paidSale = await createSaleViaBasket({
      paymentMethod: "CARD",
      amountPence: 1500,
      providerRef: `m40-refund-source-${token}`,
    });
    const paymentId = paidSale.payment?.id;
    assert.ok(paymentId, "missing payment id for refund test");

    const refund = await apiJson({
      path: `/api/payments/${encodeURIComponent(paymentId)}/refund`,
      method: "POST",
      body: {
        amountPence: 300,
        reason: "m40 refund smoke",
        idempotencyKey: `m40-refund-${token}`,
      },
      cookie,
    });

    const refundId = refund.payload.refund?.id;
    assert.ok(refundId, "missing refund id");
    created.refundIds.add(refundId);

    const issuedRefund = await apiJson({
      path: "/api/receipts/issue",
      method: "POST",
      body: {
        refundId,
      },
      cookie,
    });
    assert.equal(issuedRefund.status, 201, JSON.stringify(issuedRefund.payload));
    assert.ok(issuedRefund.payload.receipt?.receiptNumber);
    created.receiptNumbers.add(issuedRefund.payload.receipt.receiptNumber);

    const refundReceipt = await apiJson({
      path: `/api/receipts/${encodeURIComponent(issuedRefund.payload.receipt.receiptNumber)}`,
      cookie,
    });
    assert.equal(refundReceipt.payload.type, "REFUND");
    assert.equal(refundReceipt.payload.refundId, refundId);
    assert.equal(refundReceipt.payload.refund?.amountPence, 300);

    console.log("M40 receipts smoke tests passed.");
  } finally {
    await prisma.appConfig.deleteMany({
      where: {
        key: {
          in: [
            "store.logoUrl",
            "store.uploadedLogoPath",
            "receipts.printAgent",
            "receipts.workstationDefaults",
            "receipts.defaultReceiptPrinterId",
          ],
        },
      },
    });

    for (const storeLogoPath of created.storeLogoPaths) {
      const absolutePath = path.join(process.cwd(), storeLogoPath.replace(/^\/+/, ""));
      await fs.unlink(absolutePath).catch(() => {});
    }

    const receiptNumbers = Array.from(created.receiptNumbers);
    if (receiptNumbers.length > 0) {
      await prisma.receipt.deleteMany({
        where: { receiptNumber: { in: receiptNumbers } },
      });
    }

    const refundIds = Array.from(created.refundIds);
    if (refundIds.length > 0) {
      await prisma.paymentRefund.deleteMany({
        where: { id: { in: refundIds } },
      });
    }

    const paymentIds = Array.from(created.paymentIds);
    if (paymentIds.length > 0) {
      await prisma.payment.deleteMany({
        where: { id: { in: paymentIds } },
      });
    }

    const saleIds = Array.from(created.saleIds);
    if (saleIds.length > 0) {
      await prisma.saleTender.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.paymentIntent.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } });
      await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    }

    const basketIds = Array.from(created.basketIds);
    if (basketIds.length > 0) {
      await prisma.basketItem.deleteMany({ where: { basketId: { in: basketIds } } });
      await prisma.basket.deleteMany({ where: { id: { in: basketIds } } });
    }

    if (created.variantId) {
      await prisma.stockLedgerEntry.deleteMany({ where: { variantId: created.variantId } });
      await prisma.inventoryMovement.deleteMany({ where: { variantId: created.variantId } });
      await prisma.barcode.deleteMany({ where: { variantId: created.variantId } });
      await prisma.variant.deleteMany({ where: { id: created.variantId } });
    }

    const printerIds = Array.from(created.printerIds);
    const printJobIds = Array.from(created.printJobIds);
    if (printJobIds.length > 0) {
      await prisma.printJob.deleteMany({ where: { id: { in: printJobIds } } });
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: "PRINT_JOB",
          entityId: { in: printJobIds },
        },
      });
    }
    if (printerIds.length > 0) {
      await prisma.printer.deleteMany({ where: { id: { in: printerIds } } });
    }

    if (created.productId) {
      await prisma.product.deleteMany({ where: { id: created.productId } });
    }

    if (created.userId) {
      await prisma.user.deleteMany({ where: { id: created.userId } });
    }

    await prisma.$disconnect();
    await serverController.stop();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
