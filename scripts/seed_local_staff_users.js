#!/usr/bin/env node
require("dotenv/config");

const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const DEFAULT_PASSWORD = process.env.LOCAL_STAFF_PASSWORD || "ChangeMe123!";
if (DEFAULT_PASSWORD.length < 8) {
  throw new Error("LOCAL_STAFF_PASSWORD must be at least 8 characters.");
}

const LOCAL_STAFF_FIXTURES = [
  {
    name: "Dom",
    email: "dom@corepos.local",
    role: "STAFF",
    operationalRole: "WORKSHOP",
    pin: "2468",
  },
  {
    name: "Eric",
    email: "eric@corepos.local",
    role: "STAFF",
    operationalRole: "SALES",
    pin: "1357",
  },
  {
    name: "Mike",
    email: "mike@corepos.local",
    role: "STAFF",
    operationalRole: "WORKSHOP",
    pin: "4321",
  },
  {
    name: "Thomas",
    email: "thomas@corepos.local",
    role: "MANAGER",
    operationalRole: "MIXED",
    pin: "8642",
  },
];

const LEGACY_LOCAL_STAFF_EMAILS = [
  "jordan.patel@corepos.local",
  "alex.turner@corepos.local",
  "casey.hudson@corepos.local",
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

const toBaseUsername = (email) => email.toLowerCase();

const getUniqueUsername = async (tx, base) => {
  const root = base.slice(0, 80);
  for (let i = 0; i < 1000; i += 1) {
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
    const results = [];

    await prisma.$transaction(async (tx) => {
      await tx.user.deleteMany({
        where: {
          email: {
            in: LEGACY_LOCAL_STAFF_EMAILS,
          },
        },
      });

      for (const fixture of LOCAL_STAFF_FIXTURES) {
        const normalizedEmail = fixture.email.toLowerCase();
        const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
        const pinHash = await bcrypt.hash(fixture.pin, 12);

        const existing = await tx.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (existing) {
          const updated = await tx.user.update({
            where: { id: existing.id },
            data: {
              name: fixture.name,
              role: fixture.role,
              operationalRole: fixture.operationalRole,
              isActive: true,
              passwordHash,
              pinHash,
            },
          });

          results.push({
            status: "updated",
            email: updated.email,
            name: updated.name,
            role: updated.role,
            operationalRole: updated.operationalRole,
            pin: fixture.pin,
          });
          continue;
        }

        const username = await getUniqueUsername(tx, toBaseUsername(normalizedEmail));
        const created = await tx.user.create({
          data: {
            username,
            email: normalizedEmail,
            name: fixture.name,
            passwordHash,
            pinHash,
            role: fixture.role,
            operationalRole: fixture.operationalRole,
            isActive: true,
          },
        });

        results.push({
          status: "created",
          email: created.email,
          name: created.name,
          role: created.role,
          operationalRole: created.operationalRole,
          pin: fixture.pin,
        });
      }
    });

    console.log("Local staff users ready:");
    for (const result of results) {
      console.log(
        `- ${result.status}: ${result.name} <${result.email}> [${result.role}/${result.operationalRole}] PIN ${result.pin}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
