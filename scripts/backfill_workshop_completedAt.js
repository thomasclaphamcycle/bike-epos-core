#!/usr/bin/env node
require("dotenv/config");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const run = async () => {
  const updatedCount = await prisma.$executeRaw`
    UPDATE "WorkshopJob"
    SET "completedAt" = "updatedAt"
    WHERE status = 'COMPLETED'
      AND "completedAt" IS NULL
  `;

  console.log(`Backfill finished. Rows updated=${Number(updatedCount)}`);
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
