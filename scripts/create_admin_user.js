#!/usr/bin/env node
require("dotenv/config");

const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const ADMIN_NAME = (process.env.ADMIN_NAME || "Admin User").trim();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

if (!ADMIN_EMAIL || !ADMIN_EMAIL.includes("@")) {
  throw new Error("ADMIN_EMAIL must be set to a valid email.");
}
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  throw new Error("ADMIN_PASSWORD must be at least 8 characters.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const toBaseUsername = (email) => email.toLowerCase();

const getUniqueUsername = async (tx, base) => {
  const root = base.slice(0, 80);
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? root : `${root}-${i}`;
    const existing = await tx.user.findUnique({ where: { username: candidate } });
    if (!existing) {
      return candidate;
    }
  }
  throw new Error("Could not allocate unique username");
};

const run = async () => {
  try {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    const user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: ADMIN_EMAIL } });
      if (existing) {
        return tx.user.update({
          where: { id: existing.id },
          data: {
            name: ADMIN_NAME,
            role: "ADMIN",
            isActive: true,
            passwordHash,
          },
        });
      }

      const username = await getUniqueUsername(tx, toBaseUsername(ADMIN_EMAIL));
      return tx.user.create({
        data: {
          username,
          email: ADMIN_EMAIL,
          name: ADMIN_NAME,
          role: "ADMIN",
          isActive: true,
          passwordHash,
        },
      });
    });

    console.log(`Admin user ready: ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
