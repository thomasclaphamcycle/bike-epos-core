import "dotenv/config";
import express from "express";
import { prisma } from "./lib/prisma";
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
import { purchaseOrderRouter } from "./routes/purchaseOrderRoutes";
import { tillRouter } from "./routes/tillRoutes";
import { refundRouter } from "./routes/refundRoutes";
import { cashRouter } from "./routes/cashRoutes";
import { tillUiRouter } from "./routes/tillUiRoutes";
import { findBarcodeOrThrow } from "./services/productLookupService";
import { errorHandler } from "./middleware/errorHandler";
import { enforceAuthMode, requireRoleAtLeast } from "./middleware/staffRole";
import { HttpError } from "./utils/http";
import { bootstrapHandler } from "./controllers/authController";

const app = express();
app.use(express.json());
app.use(enforceAuthMode);

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

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.get("/", (req, res) => {
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
app.use("/api/products", productRouter);
app.use("/api/variants", variantRouter);
app.use("/api/stock", stockRouter);
app.use("/api/inventory", inventoryLedgerRouter);
app.use("/api/inventory", inventoryAdjustmentRouter);
app.use("/api/stocktakes", stocktakeRouter);
app.use("/api/stocktake", stocktakeSessionRouter);
app.use("/api/suppliers", supplierRouter);
app.use("/api/purchase-orders", purchaseOrderRouter);
app.use("/api/till", tillRouter);
app.use("/api/refunds", refundRouter);
app.use("/api/cash", cashRouter);
app.use("/api/workshop", workshopRouter);
app.use("/api/workshop-jobs", workshopJobPartRouter);
app.use("/api/workshop-bookings", workshopBookingRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/credits", creditRouter);
app.use("/api/locations", locationRouter);
app.use("/api/reports", reportRouter);
app.use("/api/reports/workshop", workshopReportRouter);
app.use("/api/audit", auditRouter);
app.use("/", authUiRouter);
app.use("/", adminUiRouter);
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

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
