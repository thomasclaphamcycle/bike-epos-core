/**
 * Development helper for resetting admin PIN in local environments.
 *
 * This script is intentionally local/dev-only. It is not wired into
 * application startup, seed flows, routes, or production code paths.
 */

require("dotenv/config");

const bcrypt = require("bcryptjs");
const { PrismaClient, UserRole } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const DEFAULT_BCRYPT_ROUNDS = 12;
const TARGET_PIN = "1234";
const TARGET_EMAIL = "admin@local";
const TARGET_NAME = "Demo Admin";

const toBcryptRounds = () => {
  const raw = process.env.AUTH_BCRYPT_ROUNDS;
  if (!raw) {
    return DEFAULT_BCRYPT_ROUNDS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 8 || parsed > 14) {
    return DEFAULT_BCRYPT_ROUNDS;
  }

  return parsed;
};

async function main() {
  const adminUsers = await prisma.user.findMany({
    where: {
      role: UserRole.ADMIN,
      isActive: true,
      OR: [{ email: TARGET_EMAIL }, { name: TARGET_NAME }],
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  const exactUser = adminUsers.find(
    (user) => user.email === TARGET_EMAIL && user.name === TARGET_NAME,
  );

  if (!exactUser) {
    throw new Error(
      `Could not find the expected active admin user (${TARGET_NAME} / ${TARGET_EMAIL}).`,
    );
  }

  const pinHash = await bcrypt.hash(TARGET_PIN, toBcryptRounds());

  await prisma.user.update({
    where: { id: exactUser.id },
    data: { pinHash },
  });

  console.log(
    `Admin PIN reset successfully for ${exactUser.name} (${exactUser.email}).`,
  );
}

main()
  .catch((error) => {
    console.error("Failed to reset admin PIN:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
