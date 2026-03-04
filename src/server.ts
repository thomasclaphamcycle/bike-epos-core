import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const app = express();
app.use(express.json());

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

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

  res.json(user);
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

  const barcode = await prisma.barcode.findUnique({
    where: { code },
    include: {
      variant: {
        include: {
          product: true
        }
      }
    }
  });

  if (!barcode) {
    return res.status(404).json({ error: "Barcode not found" });
  }

  res.json({
    product: barcode.variant.product.name,
    variant: barcode.variant.name,
    sku: barcode.variant.sku,
    price: barcode.variant.pricePence
  });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});