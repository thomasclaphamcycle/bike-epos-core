import "dotenv/config";
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
import { publicCustomerCaptureRouter } from "./routes/publicCustomerCaptureRoutes";
import { tillUiRouter } from "./routes/tillUiRoutes";
import { findBarcodeOrThrow } from "./services/productLookupService";
import { errorHandler } from "./middleware/errorHandler";
import { requestLoggingMiddleware } from "./middleware/requestLogging";
import { enforceAuthMode, requireRoleAtLeast } from "./middleware/staffRole";
import { isCorePosDebugEnabled, logCorePosDebug, logCorePosEvent } from "./lib/operationalLogger";
import { HttpError } from "./utils/http";
import { bootstrapHandler } from "./controllers/authController";
import { registerInternalEventSubscribers } from "./core/eventSubscribers";

const app = express();
registerInternalEventSubscribers();
app.use(requestLoggingMiddleware);
app.use(express.json({ limit: "12mb" }));
app.use(enforceAuthMode);

const projectRoot = process.cwd();
const frontendDistDir = path.join(projectRoot, "frontend", "dist");
const frontendIndexFile = path.join(frontendDistDir, "index.html");
const uploadsDir = path.join(projectRoot, "uploads");
const serveFrontendSpa =
  process.env.NODE_ENV === "production" && fs.existsSync(frontendIndexFile);

const isLegacyPrintableRoute = (requestPath: string) =>
  /^\/r\/[^/]+$/.test(requestPath) ||
  /^\/sales\/[^/]+\/receipt$/.test(requestPath) ||
  /^\/workshop\/[^/]+\/print$/.test(requestPath);

app.post("/auth/bootstrap", bootstrapHandler);

app.post("/dev/product", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
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
  if (process.env.NODE_ENV === "production") {
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
app.use("/api/system", systemRouter);
app.use("/api/rota", rotaRouter);
app.use("/api/rota/holiday-requests", holidayRequestRouter);
app.use("/api/dashboard", dashboardWeatherRouter);
app.use("/api/till", tillRouter);
app.use("/api/refunds", refundRouter);
app.use("/api/cash", cashRouter);
app.use("/api/management/cash", managementCashRouter);
app.use("/api/public", publicReceiptUploadRouter);
app.use("/api/public", publicCustomerCaptureRouter);
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

const startServer = async () => {
  const startupPayload: Record<string, unknown> = {
    environment: process.env.NODE_ENV || "development",
    port,
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

    if (isCorePosDebugEnabled()) {
      logCorePosDebug("server.startup.preflight", {
        ...startupPayload,
        checks,
      });
    }
  } catch (error) {
    startupPayload.databaseStatus = "error";
    startupPayload.migrationStatus = "error";
    startupPayload.preflightError =
      error instanceof Error ? error.message : String(error);
    logCorePosEvent("server.startup.preflight_failed", startupPayload, "warn");
  }

  app.listen(port, () => {
    logCorePosEvent("server.listening", {
      ...startupPayload,
      resultStatus: "succeeded",
      url: `http://localhost:${port}`,
    });
  });
};

void startServer();
