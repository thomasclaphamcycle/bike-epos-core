import "dotenv/config";

import { prisma } from "../../src/lib/prisma";
import { hashPassword, hashPin } from "../../src/services/passwordService";
import { LOCAL_DEV_STAFF_PASSWORD } from "./local_staff_fixtures";

const USERNAME = "thomas";
const NAME = "Thomas";
const PIN = "9999";
const DEV_PASSWORD = process.env.THOMAS_ADMIN_DEV_PASSWORD?.trim() || LOCAL_DEV_STAFF_PASSWORD;

export async function createThomasAdmin() {
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
}

async function main() {
  await createThomasAdmin();
  console.log("Admin user 'Thomas' ready with PIN 9999 and the configured local-dev password.");
}

if (require.main === module) {
  void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
}
