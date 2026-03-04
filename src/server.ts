import "dotenv/config";
import express from "express";
import { prisma } from "./lib/prisma";
import { basketRouter } from "./routes/basketRoutes";
import { salesRouter } from "./routes/salesRoutes";
import { customerRouter } from "./routes/customerRoutes";
import { workshopRouter } from "./routes/workshopRoutes";
import { workshopBookingRouter } from "./routes/workshopBookingRoutes";
import { paymentRouter } from "./routes/paymentRoutes";
import { creditRouter } from "./routes/creditRoutes";
import { workshopReportRouter } from "./routes/workshopReportRoutes";
import { auditRouter } from "./routes/auditRoutes";
import { productRouter } from "./routes/productRoutes";
import { variantRouter } from "./routes/variantRoutes";
import { stockRouter } from "./routes/stockRoutes";
import { findBarcodeOrThrow } from "./services/productLookupService";
import { errorHandler } from "./middleware/errorHandler";
import { HttpError } from "./utils/http";

const app = express();
app.use(express.json());

app.post("/auth/bootstrap", async (req, res) => {
  const { username, name, password } = req.body as {
    username: string;
    name?: string;
    password: string;
  };

  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }

  const count = await prisma.user.count();
  if (count > 0) {
    return res.status(403).json({ error: "Bootstrap disabled (users already exist)" });
  }

  const user = await prisma.user.create({
  data: {
    username,
    name,
    passwordHash: password, // TEMP — we will hash properly next
    role: "ADMIN",
  },
  select: { id: true, username: true, name: true, role: true, createdAt: true, updatedAt: true },
});

return res.json(user);
});

app.post("/dev/product", async (req, res) => {
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

app.get("/users", async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
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
app.use("/api/sales", salesRouter);
app.use("/api/customers", customerRouter);
app.use("/api/products", productRouter);
app.use("/api/variants", variantRouter);
app.use("/api/stock", stockRouter);
app.use("/api/workshop", workshopRouter);
app.use("/api/workshop-bookings", workshopBookingRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/credits", creditRouter);
app.use("/api/reports/workshop", workshopReportRouter);
app.use("/api/audit", auditRouter);
app.use(errorHandler);

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
