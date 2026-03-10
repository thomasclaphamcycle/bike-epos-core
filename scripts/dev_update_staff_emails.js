/**
 * Development helper for updating existing staff emails in local environments.
 *
 * This script is intentionally local/dev-only. It is not wired into
 * application startup, seed flows, routes, or production code paths.
 */

require("dotenv/config");

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const EMAIL_UPDATES = {
  eric: "ericjbattley07@gmail.com",
  thomas: "thomas@claphamcycle.com",
  kyle: "kyle@claphamcycle.com",
};

const USER_LOOKUP = {
  eric: { username: "staff", expectedName: "Eric" },
  thomas: { username: "admin", expectedName: "Thomas" },
  kyle: { username: "manager", expectedName: "Kyle" },
};

async function main() {
  const beforeRows = [];
  const afterRows = [];

  for (const [key, nextEmail] of Object.entries(EMAIL_UPDATES)) {
    const lookup = USER_LOOKUP[key];
    if (!lookup) {
      throw new Error(`Missing lookup config for ${key}`);
    }

    const user = await prisma.user.findUnique({
      where: { username: lookup.username },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
        pinHash: true,
      },
    });

    if (!user) {
      throw new Error(`Target user not found for username "${lookup.username}"`);
    }

    if (user.name !== lookup.expectedName) {
      throw new Error(
        `User "${lookup.username}" does not match expected name "${lookup.expectedName}"`,
      );
    }

    const emailOwner = await prisma.user.findFirst({
      where: {
        email: nextEmail,
        NOT: { id: user.id },
      },
      select: { id: true, username: true, email: true },
    });

    if (emailOwner) {
      throw new Error(
        `Target email "${nextEmail}" is already used by "${emailOwner.username}" (${emailOwner.id})`,
      );
    }

    beforeRows.push({
      key,
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      passwordHash: user.passwordHash,
      pinHash: user.pinHash,
    });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email: nextEmail },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
        pinHash: true,
      },
    });

    if (updated.passwordHash !== user.passwordHash) {
      throw new Error(`passwordHash changed unexpectedly for ${lookup.username}`);
    }

    if (updated.pinHash !== user.pinHash) {
      throw new Error(`pinHash changed unexpectedly for ${lookup.username}`);
    }

    afterRows.push({
      key,
      id: updated.id,
      username: updated.username,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
    });
  }

  console.log("Staff email update completed successfully.\n");
  console.log("Before:");
  console.table(
    beforeRows.map(({ key, passwordHash, pinHash, ...row }) => ({
      key,
      ...row,
      hasPasswordHash: Boolean(passwordHash),
      hasPinHash: Boolean(pinHash),
    })),
  );
  console.log("After:");
  console.table(afterRows);
}

main()
  .catch((error) => {
    console.error("Failed to update staff emails:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
