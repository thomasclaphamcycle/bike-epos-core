import "dotenv/config";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  LOCAL_DEV_STAFF_FIXTURES,
  LOCAL_DEV_STAFF_PASSWORD,
  type LocalDevStaffFixture,
} from "./local_staff_fixtures";
import { hashPassword, hashPin, normalizePinOrThrow } from "../../src/services/passwordService";

const RESERVED_DATABASES = new Set(["postgres", "template0", "template1"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const assertLocalDevDatabase = () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname.replace(/^\//, "");

  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run local staff restore in production mode.");
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing to run local staff restore against non-local host: ${parsed.hostname}`);
  }
  if (!databaseName) {
    throw new Error("DATABASE_URL must include a database name.");
  }
  if (RESERVED_DATABASES.has(databaseName)) {
    throw new Error(`Refusing to run local staff restore against reserved database: ${databaseName}`);
  }
  if (databaseName === "bike_epos_test" || databaseName.endsWith("_test")) {
    throw new Error(`Refusing to run local staff restore against test database: ${databaseName}`);
  }
  if (LOCAL_DEV_STAFF_PASSWORD.length < 8) {
    throw new Error("LOCAL_STAFF_PASSWORD must be at least 8 characters.");
  }

  return databaseUrl;
};

const buildFixtureMatchers = (fixture: LocalDevStaffFixture) => {
  const usernameMatchers = [fixture.username, ...(fixture.matchUsernames ?? [])].map((username) => ({
    username,
  }));

  return [
    ...usernameMatchers,
    { email: fixture.email },
  ];
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: assertLocalDevDatabase(),
  }),
});

const upsertFixture = async (
  tx: Pick<PrismaClient, "user">,
  fixture: LocalDevStaffFixture,
) => {
  const normalizedPin = normalizePinOrThrow(fixture.pin, "INVALID_LOCAL_STAFF_PIN");
  const passwordHash = await hashPassword(LOCAL_DEV_STAFF_PASSWORD);
  const pinHash = await hashPin(normalizedPin);
  const matches = await tx.user.findMany({
    where: {
      OR: buildFixtureMatchers(fixture),
    },
    select: {
      id: true,
      username: true,
      email: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (matches.length > 1) {
    const identities = matches
      .map((user) => `${user.username}${user.email ? ` <${user.email}>` : ""}`)
      .join(", ");
    throw new Error(`Multiple users match local staff fixture ${fixture.username}: ${identities}`);
  }

  const data = {
    username: fixture.username,
    email: fixture.email,
    name: fixture.name,
    role: fixture.role,
    operationalRole: fixture.operationalRole,
    isActive: fixture.isActive,
    passwordHash,
    pinHash,
  };

  if (matches.length === 1) {
    const updated = await tx.user.update({
      where: { id: matches[0].id },
      data,
    });

    return { status: "updated" as const, user: updated };
  }

  const created = await tx.user.create({ data });
  return { status: "created" as const, user: created };
};

async function main() {
  const results = await prisma.$transaction(async (tx) => {
    const nextResults = [];
    for (const fixture of LOCAL_DEV_STAFF_FIXTURES) {
      nextResults.push(await upsertFixture(tx, fixture));
    }
    return nextResults;
  });

  console.log("Local dev staff users ready:");
  console.log(`- Shared password: ${LOCAL_DEV_STAFF_PASSWORD}`);
  for (const result of results) {
    const fixture = LOCAL_DEV_STAFF_FIXTURES.find((entry) => entry.username === result.user.username);
    console.log(
      `- ${result.status}: ${result.user.name} <${result.user.email}> [${result.user.role}/${result.user.operationalRole ?? "UNSET"}] active=${result.user.isActive} PIN ${fixture?.pin ?? "unset"}`,
    );
  }
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
