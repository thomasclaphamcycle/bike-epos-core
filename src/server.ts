import "dotenv/config";
import type { Server as HttpServer } from "node:http";
import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "./lib/prisma";
import { getHealthStatus } from "./services/healthService";
import { basketRouter } from "./routes/basketRoutes";
import { salesRouter } from "./routes/salesRoutes";
import { customerRouter } from "./routes/customerRoutes";
import { authRouter } from "./routes/authRoutes";
import { workshopRouter } from "./routes/workshopRoutes";
import { workshopBookingRouter } from "./routes/workshopBookingRoutes";
import { paymentRouter } from "./routes/paymentRoutes";
import { receiptRouter } from "./routes/receiptRoutes";
import { creditRouter } from "./routes/creditRoutes";
import { workshopReportRouter } from "./routes/workshopReportRoutes";
import { reportRouter } from "./routes/reportRoutes";
import { locationRouter } from "./routes/locationRoutes";
import { reportsUiRouter } from "./routes/reportsUiRoutes";
import { catalogUiRouter } from "./routes/catalogUiRoutes";
import { inventoryUiRouter } from "./routes/inventoryUiRoutes";
import { inventoryAdjustUiRouter } from "./routes/inventoryAdjustUiRoutes";
import { purchasingUiRouter } from "./routes/purchasingUiRoutes";
import { posUiRouter } from "./routes/posUiRoutes";
import { workshopUiRouter } from "./routes/workshopUiRoutes";
import { receiptUiRouter } from "./routes/receiptUiRoutes";
import { authUiRouter } from "./routes/authUiRoutes";
import { adminUiRouter } from "./routes/adminUiRoutes";
import { managerUiRouter } from "./routes/managerUiRoutes";
import { auditRouter } from "./routes/auditRoutes";
import { adminRouter } from "./routes/adminRoutes";
import { productRouter } from "./routes/productRoutes";
import { variantRouter } from "./routes/variantRoutes";
import { stockRouter } from "./routes/stockRoutes";
import { inventoryLedgerRouter } from "./routes/inventoryLedgerRoutes";
import { inventoryAdjustmentRouter } from "./routes/inventoryAdjustmentRoutes";
import { stocktakeRouter } from "./routes/stocktakeRoutes";
import { stocktakeSessionRouter } from "./routes/stocktakeSessionRoutes";
import { workshopJobPartRouter } from "./routes/workshopJobPartRoutes";
import { supplierRouter } from "./routes/supplierRoutes";
import { supplierProductLinkRouter } from "./routes/supplierProductLinkRoutes";
import { purchaseOrderRouter } from "./routes/purchaseOrderRoutes";
import { stockTransferRouter } from "./routes/stockTransferRoutes";
import { bikeHireRouter } from "./routes/bikeHireRoutes";
import { settingsRouter } from "./routes/settingsRoutes";
import { configRouter } from "./routes/configRoutes";
import { dashboardWeatherRouter } from "./routes/dashboardWeatherRoutes";
import { systemRouter } from "./routes/systemRoutes";
import { tillRouter } from "./routes/tillRoutes";
import { refundRouter } from "./routes/refundRoutes";
import { cashRouter } from "./routes/cashRoutes";
import { managementCashRouter } from "./routes/managementCashRoutes";
import { publicReceiptUploadRouter } from "./routes/publicReceiptUploadRoutes";
import { rotaRouter } from "./routes/rotaRoutes";
import { holidayRequestRouter } from "./routes/holidayRequestRoutes";
import { staffDirectoryRouter } from "./routes/staffDirectoryRoutes";
import { publicWorkshopQuoteRouter } from "./routes/publicWorkshopQuoteRoutes";
import { customerAuthRouter } from "./routes/customerAuthRoutes";
import { customerAccountRouter } from "./routes/customerAccountRoutes";
import { onlineStoreRouter } from "./routes/onlineStoreRoutes";
import { tillUiRouter } from "./routes/tillUiRoutes";
import { eventRouter } from "./routes/eventRoutes";
import { shippingProviderWebhookRouter } from "./routes/shippingProviderWebhookRoutes";
import { managedPrintJobRouter } from "./routes/managedPrintJobRoutes";
import { findBarcodeOrThrow } from "./services/productLookupService";
import { errorHandler } from "./middleware/errorHandler";
import { requestContextMiddleware } from "./middleware/requestContext";
import { requestLoggingMiddleware } from "./middleware/requestLogging";
import { enforceAuthMode, requireRoleAtLeast } from "./middleware/staffRole";
import { HttpError } from "./utils/http";
import { logger } from "./utils/logger";
import { bootstrapHandler } from "./controllers/authController";
import { registerInternalEventSubscribers } from "./core/eventSubscribers";
import { getRuntimeDiagnosticsSnapshot } from "./services/runtimeDiagnosticsService";
import { startManagedPrintQueueWorker } from "./services/managedPrintQueueService";

const app = express();
registerInternalEventSubscribers();
startManagedPrintQueueWorker();
app.use(requestContextMiddleware);
app.use(requestLoggingMiddleware);
app.use("/api/shipping/providers", shippingProviderWebhookRouter);
app.use(express.json({ limit: "12mb" }));
app.use(enforceAuthMode);

const projectRoot = process.cwd();
const frontendDistDir = path.join(projectRoot, "frontend", "dist");
const frontendIndexFile = path.join(frontendDistDir, "index.html");
const uploadsDir = path.join(projectRoot, "uploads");
const serveFrontendSpa =
  process.env.NODE_ENV === "production" && fs.existsSync(frontendIndexFile);
const isDevelopmentEnvironment = process.env.NODE_ENV === "development";

const isLegacyPrintableRoute = (requestPath: string) =>
  /^\/r\/[^/]+$/.test(requestPath) ||
  /^\/sales\/[^/]+\/receipt$/.test(requestPath) ||
  /^\/workshop\/[^/]+\/print$/.test(requestPath) ||
  /^\/reports\/daily-close\/print$/.test(requestPath);

app.post("/auth/bootstrap", bootstrapHandler);

app.post("/dev/product", async (req, res) => {
  if (!isDevelopmentEnvironment) {
    return res.status(404).json({ error: "Not found" });
  }

  const product = await prisma.product.create({
    data: {
      name: "Inner Tube",
      brand: "Schwalbe",
      description: "Road tube",
    },
  });

  return res.json(product);
});

app.post("/dev/seed-tube", async (req, res) => {
  if (!isDevelopmentEnvironment) {
    return res.status(404).json({ error: "Not found" });
  }

  const variant = await prisma.variant.create({
    data: {
      product: {
        connect: {
          id: "cmmc05zf90000y1l0dl90n6to"
        }
      },
      sku: "TUBE-700x25",
      name: "700x25-32 Presta",
      retailPricePence: 699,
      costPricePence: 300
    }
  });

  const barcode = await prisma.barcode.create({
    data: {
      variantId: variant.id,
      code: "1234567890123",
      type: "EAN",
      isPrimary: true
    }
  });

  res.json({ variant, barcode });
});

app.get("/health", async (req, res, next) => {
  try {
    const includeDetails =
      req.query.details === "1" ||
      req.query.details === "true" ||
      req.query.checks === "1" ||
      req.query.checks === "true";
    const result = await getHealthStatus(includeDetails);
    res.status(result.httpStatus).json(result.body);
  } catch (error) {
    next(error);
  }
});

app.get("/metrics", requireRoleAtLeast("MANAGER"), async (req, res, next) => {
  try {
    const healthStatus = await getHealthStatus(true);
    const runtimeDiagnostics = getRuntimeDiagnosticsSnapshot();
    res.status(healthStatus.httpStatus).json({
      ...healthStatus.body,
      diagnostics: runtimeDiagnostics.diagnostics,
      features: runtimeDiagnostics.features,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/", (req, res) => {
  if (serveFrontendSpa) {
    return res.sendFile(frontendIndexFile);
  }
  if (req.user) {
    return res.redirect("/pos");
  }
  return res.redirect("/login");
});

app.get("/users", requireRoleAtLeast("ADMIN"), async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json(users);
});

app.get("/scan/:code", async (req, res) => {
  const { code } = req.params;

  try {
    const barcode = await findBarcodeOrThrow(code);

    res.json({
      product: barcode.variant.product.name,
      variant: barcode.variant.name,
      sku: barcode.variant.sku,
      price: barcode.variant.retailPricePence
    });
  } catch (error) {
    if (error instanceof HttpError && error.code === "BARCODE_NOT_FOUND") {
      return res.status(404).json({ error: "Barcode not found" });
    }
    throw error;
  }
});

app.use("/api/baskets", basketRouter);
app.use("/api/auth", authRouter);
app.use("/api/customer-auth", customerAuthRouter);
app.use("/api/customer-account", customerAccountRouter);
app.use("/api/online-store", onlineStoreRouter);
app.use("/api/print-jobs", managedPrintJobRouter);
app.use("/api/sales", salesRouter);
app.use("/api/receipts", receiptRouter);
app.use("/api/customers", customerRouter);
app.use("/api/admin", adminRouter);
app.use("/api/staff-directory", staffDirectoryRouter);
app.use("/api/products", productRouter);
app.use("/api/variants", variantRouter);
app.use("/api/stock", stockRouter);
app.use("/api/inventory", inventoryLedgerRouter);
app.use("/api/inventory", inventoryAdjustmentRouter);
app.use("/api/stocktakes", stocktakeRouter);
app.use("/api/stocktake", stocktakeSessionRouter);
app.use("/api/suppliers", supplierRouter);
app.use("/api/supplier-product-links", supplierProductLinkRouter);
app.use("/api/purchase-orders", purchaseOrderRouter);
app.use("/api/stock-transfers", stockTransferRouter);
app.use("/api/hire", bikeHireRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/config", configRouter);
app.use("/api/system", systemRouter);
app.use("/api/rota", rotaRouter);
app.use("/api/rota/holiday-requests", holidayRequestRouter);
app.use("/api/dashboard", dashboardWeatherRouter);
app.use("/api/till", tillRouter);
app.use("/api/refunds", refundRouter);
app.use("/api/cash", cashRouter);
app.use("/api/management/cash", managementCashRouter);
app.use("/api/public", publicReceiptUploadRouter);
app.use("/api/public", publicWorkshopQuoteRouter);
app.use("/api/events", eventRouter);
app.use("/api/workshop", workshopRouter);
app.use("/api/workshop-jobs", workshopJobPartRouter);
app.use("/api/workshop-bookings", workshopBookingRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/credits", creditRouter);
app.use("/api/locations", locationRouter);
app.use("/api/reports", reportRouter);
app.use("/api/reports/workshop", workshopReportRouter);
app.use("/api/audit", auditRouter);
app.use("/uploads", express.static(uploadsDir));

if (serveFrontendSpa) {
  app.use(
    express.static(frontendDistDir, {
      index: false,
    }),
  );

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health" || isLegacyPrintableRoute(req.path)) {
      return next();
    }

    return res.sendFile(frontendIndexFile);
  });
}

app.use("/", authUiRouter);
app.use("/", adminUiRouter);
app.use("/", managerUiRouter);
app.use("/", reportsUiRouter);
app.use("/", catalogUiRouter);
app.use("/", inventoryUiRouter);
app.use("/", inventoryAdjustUiRouter);
app.use("/", purchasingUiRouter);
app.use("/", posUiRouter);
app.use("/", workshopUiRouter);
app.use("/", receiptUiRouter);
app.use("/", tillUiRouter);
app.use(errorHandler);

const port = Number(process.env.PORT || 3000);
const shutdownTimeoutMs = Number(process.env.SERVER_SHUTDOWN_TIMEOUT_MS || 5000);
let httpServer: HttpServer | null = null;
let shutdownPromise: Promise<void> | null = null;

const closeHttpServer = async () => {
  if (!httpServer) {
    return;
  }

  const serverToClose = httpServer;
  httpServer = null;
  serverToClose.closeIdleConnections?.();

  await new Promise<void>((resolve, reject) => {
    serverToClose.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const shutdownServer = async (signal: "SIGINT" | "SIGTERM") => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  logger.warn(
    "process.signal",
    {
      resultStatus: "received",
      signal,
      pid: process.pid,
    },
  );

  shutdownPromise = (async () => {
    const forceExitTimer = setTimeout(() => {
      if (httpServer?.closeAllConnections) {
        httpServer.closeAllConnections();
      }
      logger.error(
        "server.shutdown.force_exit",
        new Error("Server shutdown timed out"),
        {
          resultStatus: "timeout",
          signal,
          pid: process.pid,
          timeoutMs: shutdownTimeoutMs,
        },
      );
      process.exit(1);
    }, shutdownTimeoutMs);
    forceExitTimer.unref();

    try {
      await closeHttpServer();
      await prisma.$disconnect();
      clearTimeout(forceExitTimer);
      logger.warn(
        "server.shutdown.complete",
        {
          resultStatus: "completed",
          signal,
          pid: process.pid,
        },
      );
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimer);
      logger.error(
        "server.shutdown.failed",
        error,
        {
          resultStatus: "failed",
          signal,
          pid: process.pid,
        },
      );
      process.exit(1);
    }
  })();

  return shutdownPromise;
};

const registerRuntimeDiagnostics = () => {
  process.on("unhandledRejection", (reason) => {
    logger.error(
      "process.unhandled_rejection",
      reason,
      {
        resultStatus: "unhandled",
      },
    );
  });

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    logger.error(
      "process.uncaught_exception",
      error,
      {
        resultStatus: "unhandled",
        origin,
      },
    );
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void shutdownServer(signal);
    });
  }
};

const startServer = async () => {
  const runtimeDiagnostics = getRuntimeDiagnosticsSnapshot();
  const startupPayload: Record<string, unknown> = {
    environment: runtimeDiagnostics.runtime.environment,
    port,
    pid: runtimeDiagnostics.runtime.pid,
    version: runtimeDiagnostics.app.version,
    revision: runtimeDiagnostics.app.revision,
    releaseLabel: runtimeDiagnostics.app.releaseLabel,
    nodeVersion: runtimeDiagnostics.runtime.nodeVersion,
    frontendServingMode: runtimeDiagnostics.features.frontendServingMode,
    frontendBundlePresent: runtimeDiagnostics.features.frontendBundlePresent,
    authMode: runtimeDiagnostics.features.authMode,
    shippingPrintAgentConfigured: runtimeDiagnostics.features.shippingPrintAgentConfigured,
    opsLoggingEnabled: runtimeDiagnostics.diagnostics.opsLoggingEnabled,
    corePosDebugEnabled: runtimeDiagnostics.diagnostics.corePosDebugEnabled,
    startedAt: runtimeDiagnostics.runtime.startedAt,
  };

  try {
    const healthStatus = await getHealthStatus(true);
    const checks =
      healthStatus.body &&
      typeof healthStatus.body === "object" &&
      "checks" in healthStatus.body &&
      typeof healthStatus.body.checks === "object" &&
      healthStatus.body.checks !== null
        ? (healthStatus.body.checks as Record<string, unknown>)
        : {};
    const databaseCheck =
      checks.database && typeof checks.database === "object"
        ? (checks.database as Record<string, unknown>)
        : null;
    const migrationCheck =
      checks.migrations && typeof checks.migrations === "object"
        ? (checks.migrations as Record<string, unknown>)
        : null;

    startupPayload.databaseStatus =
      typeof databaseCheck?.status === "string" ? databaseCheck.status : "unknown";
    startupPayload.migrationStatus =
      typeof migrationCheck?.status === "string" ? migrationCheck.status : "unknown";

    logger.debug("server.startup.preflight", {
      ...startupPayload,
      checks,
    });

    logger.info("server.startup.preflight", {
      ...startupPayload,
      resultStatus:
        startupPayload.databaseStatus === "ok" && startupPayload.migrationStatus === "ok"
          ? "ready"
          : "degraded",
    });
  } catch (error) {
    startupPayload.databaseStatus = "error";
    startupPayload.migrationStatus = "error";
    logger.error(
      "server.startup.preflight_failed",
      error,
      {
        ...startupPayload,
        resultStatus: "failed",
      },
    );
  }

  httpServer = app.listen(port, "0.0.0.0", () => {
    logger.info("server.listening", {
      ...startupPayload,
      resultStatus: "succeeded",
      bindHost: "0.0.0.0",
      url: `http://localhost:${port}`,
    });
  });
};

registerRuntimeDiagnostics();
void startServer();
