import "dotenv/config";

import { prisma } from "../../src/lib/prisma";
import { hashPassword, hashPin } from "../../src/services/passwordService";

const USERNAME = "thomas";
const NAME = "Thomas";
const PIN = "9999";
const DEV_PASSWORD = "thomas-admin-dev";

async function main() {
  const pinHash = await hashPin(PIN);
  const passwordHash = await hashPassword(DEV_PASSWORD);

  await prisma.user.upsert({
    where: { username: USERNAME },
    update: {
      name: NAME,
      role: "ADMIN",
      isActive: true,
      pinHash,
    },
    create: {
      username: USERNAME,
      name: NAME,
      role: "ADMIN",
      isActive: true,
      pinHash,
      passwordHash,
    },
  });

  console.log("Admin user 'Thomas' ready with PIN 9999");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
