#!/usr/bin/env node
require("dotenv/config");

const assert = require("node:assert/strict");
const path = require("node:path");
const { register } = require("ts-node");

register({ transpileOnly: true });

const { prisma } = require(path.join(__dirname, "..", "src", "lib", "prisma.ts"));
const { HttpError } = require(path.join(__dirname, "..", "src", "utils", "http.ts"));
const {
  __testing,
  enqueueManagedPrintJob,
  getManagedPrintJob,
  retryManagedPrintJob,
} = require(path.join(__dirname, "..", "src", "services", "managedPrintQueueService.ts"));
const { buildManagedPrintQueuePayload } = require(path.join(__dirname, "..", "src", "services", "managedPrintDispatchService.ts"));
const {
  ESC_POS_80MM_MODEL_HINT,
  RECEIPT_DOCUMENT_FORMAT,
  RECEIPT_DOCUMENT_MIME_TYPE,
  RECEIPT_PRINT_INTENT,
  RECEIPT_PRINT_REQUEST_VERSION,
  THERMAL_RECEIPT_PRINTER_FAMILY,
  WINDOWS_LOCAL_AGENT_TRANSPORT,
} = require(path.join(__dirname, "..", "shared", "receiptPrintContract.ts"));
const { MANAGED_PRINT_QUEUE_PAYLOAD_VERSION } = require(path.join(__dirname, "..", "shared", "managedPrintJobContract.ts"));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}

const uniqueToken = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const buildReceiptPrintRequest = (printer, receiptNumber) => ({
  version: RECEIPT_PRINT_REQUEST_VERSION,
  intentType: RECEIPT_PRINT_INTENT,
  saleId: `sale-${receiptNumber}`,
  receiptNumber,
  printer: {
    transport: WINDOWS_LOCAL_AGENT_TRANSPORT,
    printerId: printer.id,
    printerKey: printer.key,
    printerFamily: THERMAL_RECEIPT_PRINTER_FAMILY,
    printerModelHint: ESC_POS_80MM_MODEL_HINT,
    printerName: printer.name,
    transportMode: "DRY_RUN",
    windowsPrinterName: null,
    rawTcpHost: null,
    rawTcpPort: null,
    copies: 1,
  },
  document: {
    format: RECEIPT_DOCUMENT_FORMAT,
    mimeType: RECEIPT_DOCUMENT_MIME_TYPE,
    fileName: `${receiptNumber}.bin`,
    bytesBase64: Buffer.from(`Receipt ${receiptNumber}`, "utf8").toString("base64"),
  },
  metadata: {
    source: "PRINT_QUEUE_SMOKE",
    sourceLabel: receiptNumber,
    workstationKey: null,
    workstationLabel: null,
  },
});

const createReceiptPrinter = async (label) => {
  const token = uniqueToken().toUpperCase();
  return prisma.printer.create({
    data: {
      name: `${label} ${token}`,
      key: `${label.replace(/[^A-Z0-9]+/gi, "_").toUpperCase()}_${token}`,
      printerFamily: "THERMAL_RECEIPT",
      printerModelHint: ESC_POS_80MM_MODEL_HINT,
      supportsShippingLabels: false,
      supportsProductLabels: false,
      supportsBikeTags: false,
      supportsReceipts: true,
      isActive: true,
      transportMode: "DRY_RUN",
      location: "Smoke tests",
      notes: "Managed print queue smoke test printer",
    },
  });
};

const waitForJobMatch = async (jobId, predicate, timeoutMs = 10000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await getManagedPrintJob(jobId);
    if (predicate(payload.job)) {
      return payload.job;
    }
    await sleep(50);
  }

  throw new Error(`Timed out waiting for print job ${jobId} to reach the expected state.`);
};

const waitForTerminalJob = async (jobId, timeoutMs = 10000) =>
  waitForJobMatch(jobId, (job) => job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELLED", timeoutMs);

const run = async () => {
  const createdPrinterIds = [];
  const createdJobIds = [];

  try {
    const printerA = await createReceiptPrinter("Queue Printer A");
    const printerB = await createReceiptPrinter("Queue Printer B");
    createdPrinterIds.push(printerA.id, printerB.id);

    const activeCounts = new Map();
    const maxActiveCounts = new Map();
    const startOrder = [];

    __testing.setDispatchHandler(async (payload) => {
      const printerId = payload.printRequest.printer.printerId;
      const receiptNumber = payload.printRequest.receiptNumber;
      const activeCount = (activeCounts.get(printerId) || 0) + 1;
      activeCounts.set(printerId, activeCount);
      maxActiveCounts.set(printerId, Math.max(maxActiveCounts.get(printerId) || 0, activeCount));
      startOrder.push(`${printerId}:${receiptNumber}`);

      await sleep(receiptNumber.endsWith("1") ? 180 : 40);

      activeCounts.set(printerId, Math.max((activeCounts.get(printerId) || 1) - 1, 0));
      return {
        externalJobId: `dispatch-${receiptNumber}`,
        printerTarget: payload.printRequest.printer.printerName,
        simulated: true,
        outputPath: null,
        metadata: {
          receiptNumber,
        },
      };
    });

    const firstPrinterFirstJob = await enqueueManagedPrintJob({
      workflowType: "RECEIPT_PRINT",
      printerId: printerA.id,
      payload: buildManagedPrintQueuePayload({
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType: "RECEIPT_PRINT",
        printRequest: buildReceiptPrintRequest(printerA, "QUEUE-A-1"),
      }),
      documentLabel: "QUEUE-A-1",
    });
    const firstPrinterSecondJob = await enqueueManagedPrintJob({
      workflowType: "RECEIPT_PRINT",
      printerId: printerA.id,
      payload: buildManagedPrintQueuePayload({
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType: "RECEIPT_PRINT",
        printRequest: buildReceiptPrintRequest(printerA, "QUEUE-A-2"),
      }),
      documentLabel: "QUEUE-A-2",
    });
    const secondPrinterJob = await enqueueManagedPrintJob({
      workflowType: "RECEIPT_PRINT",
      printerId: printerB.id,
      payload: buildManagedPrintQueuePayload({
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType: "RECEIPT_PRINT",
        printRequest: buildReceiptPrintRequest(printerB, "QUEUE-B-1"),
      }),
      documentLabel: "QUEUE-B-1",
    });

    createdJobIds.push(
      firstPrinterFirstJob.job.id,
      firstPrinterSecondJob.job.id,
      secondPrinterJob.job.id,
    );

    const [firstDone, secondDone, thirdDone] = await Promise.all([
      waitForTerminalJob(firstPrinterFirstJob.job.id),
      waitForTerminalJob(firstPrinterSecondJob.job.id),
      waitForTerminalJob(secondPrinterJob.job.id),
    ]);

    assert.equal(firstDone.status, "SUCCEEDED");
    assert.equal(secondDone.status, "SUCCEEDED");
    assert.equal(thirdDone.status, "SUCCEEDED");
    assert.equal(maxActiveCounts.get(printerA.id), 1);
    assert.equal(maxActiveCounts.get(printerB.id), 1);
    assert.deepEqual(
      startOrder.filter((entry) => entry.startsWith(`${printerA.id}:`)),
      [`${printerA.id}:QUEUE-A-1`, `${printerA.id}:QUEUE-A-2`],
    );

    const retryAttempts = new Map();
    __testing.setDispatchHandler(async (payload) => {
      const receiptNumber = payload.printRequest.receiptNumber;
      const attempt = (retryAttempts.get(receiptNumber) || 0) + 1;
      retryAttempts.set(receiptNumber, attempt);

      if (receiptNumber === "RETRY-ME" && attempt === 1) {
        throw new HttpError(
          504,
          "Receipt print agent timed out after 7000ms",
          "RECEIPT_PRINT_AGENT_TIMEOUT",
        );
      }

      return {
        externalJobId: `dispatch-${receiptNumber}-${attempt}`,
        printerTarget: payload.printRequest.printer.printerName,
        simulated: true,
        outputPath: null,
        metadata: {
          receiptNumber,
          attempt,
        },
      };
    });

    const retryableJob = await enqueueManagedPrintJob({
      workflowType: "RECEIPT_PRINT",
      printerId: printerA.id,
      payload: buildManagedPrintQueuePayload({
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType: "RECEIPT_PRINT",
        printRequest: buildReceiptPrintRequest(printerA, "RETRY-ME"),
      }),
      documentLabel: "RETRY-ME",
    });
    createdJobIds.push(retryableJob.job.id);

    const pendingRetryJob = await waitForJobMatch(retryableJob.job.id, (job) =>
      job.status === "PENDING" && job.attemptCount === 1 && job.lastErrorRetryable === true,
    );
    assert.equal(pendingRetryJob.lastErrorCode, "RECEIPT_PRINT_AGENT_TIMEOUT");
    assert.ok(pendingRetryJob.nextAttemptAt);

    await prisma.printJob.update({
      where: { id: retryableJob.job.id },
      data: {
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });
    await sleep(60);
    await __testing.processDueManagedPrintJobsOnce();

    const retriedSuccess = await waitForTerminalJob(retryableJob.job.id);
    assert.equal(retriedSuccess.status, "SUCCEEDED");
    assert.equal(retriedSuccess.attemptCount, 2);

    __testing.setDispatchHandler(async (payload) => {
      const receiptNumber = payload.printRequest.receiptNumber;
      if (receiptNumber === "FAIL-HARD") {
        throw new HttpError(
          409,
          "Receipt printer route needs attention.",
          "PRINTER_TARGET_MISCONFIGURED",
        );
      }

      return {
        externalJobId: `dispatch-${receiptNumber}`,
        printerTarget: payload.printRequest.printer.printerName,
        simulated: true,
        outputPath: null,
        metadata: {
          receiptNumber,
        },
      };
    });

    const failedJob = await enqueueManagedPrintJob({
      workflowType: "RECEIPT_PRINT",
      printerId: printerA.id,
      payload: buildManagedPrintQueuePayload({
        version: MANAGED_PRINT_QUEUE_PAYLOAD_VERSION,
        workflowType: "RECEIPT_PRINT",
        printRequest: buildReceiptPrintRequest(printerA, "FAIL-HARD"),
      }),
      documentLabel: "FAIL-HARD",
    });
    createdJobIds.push(failedJob.job.id);

    const failedTerminalJob = await waitForTerminalJob(failedJob.job.id);
    assert.equal(failedTerminalJob.status, "FAILED");
    assert.equal(failedTerminalJob.attemptCount, 1);
    assert.equal(failedTerminalJob.lastErrorCode, "PRINTER_TARGET_MISCONFIGURED");
    assert.equal(failedTerminalJob.lastErrorRetryable, false);
    assert.equal(failedTerminalJob.nextAttemptAt, null);

    __testing.setDispatchHandler(async (payload) => ({
      externalJobId: `dispatch-${payload.printRequest.receiptNumber}-manual-retry`,
      printerTarget: payload.printRequest.printer.printerName,
      simulated: true,
      outputPath: null,
      metadata: {
        receiptNumber: payload.printRequest.receiptNumber,
      },
    }));

    const manuallyRetriedJob = await retryManagedPrintJob(failedJob.job.id);
    assert.equal(manuallyRetriedJob.job.status, "PENDING");
    const retriedAfterFailure = await waitForTerminalJob(failedJob.job.id);
    assert.equal(retriedAfterFailure.status, "SUCCEEDED");
    assert.equal(retriedAfterFailure.attemptCount, 1);

    console.log("managed print queue smoke tests passed");
  } finally {
    __testing.resetDispatchHandler();
    __testing.stopManagedPrintQueueWorker();
    if (createdJobIds.length > 0) {
      await prisma.printJob.deleteMany({
        where: {
          id: {
            in: createdJobIds,
          },
        },
      });
      await prisma.auditEvent.deleteMany({
        where: {
          entityType: "PRINT_JOB",
          entityId: {
            in: createdJobIds,
          },
        },
      });
    }
    if (createdPrinterIds.length > 0) {
      await prisma.printer.deleteMany({
        where: {
          id: {
            in: createdPrinterIds,
          },
        },
      });
    }
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
