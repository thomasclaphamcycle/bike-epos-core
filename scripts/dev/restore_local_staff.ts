import "dotenv/config";

import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  LOCAL_DEV_STAFF_FIXTURES,
  LOCAL_DEV_STAFF_PASSWORD,
  type LocalDevStaffFixture,
} from "./local_staff_fixtures";
import { hashPassword, hashPin, normalizePinOrThrow } from "../../src/services/passwordService";

const RESERVED_DATABASES = new Set(["postgres", "template0", "template1"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const DIRECT_USER_REFERENCE_TARGETS = [
  { table: "CashCount", column: "countedByStaffId" },
  { table: "CashMovement", column: "createdByStaffId" },
  { table: "CashSession", column: "closedByStaffId" },
  { table: "CashSession", column: "openedByStaffId" },
  { table: "HireBooking", column: "checkedOutByStaffId" },
  { table: "HireBooking", column: "createdByStaffId" },
  { table: "HireBooking", column: "returnedByStaffId" },
  { table: "HolidayRequest", column: "reviewedByUserId" },
  { table: "HolidayRequest", column: "staffId" },
  { table: "Receipt", column: "issuedByStaffId" },
  { table: "Refund", column: "createdByStaffId" },
  { table: "RefundTender", column: "createdByStaffId" },
  { table: "Sale", column: "createdByStaffId" },
  { table: "SaleTender", column: "createdByStaffId" },
  { table: "StockLedgerEntry", column: "createdByStaffId" },
  { table: "StockTransfer", column: "createdByStaffId" },
  { table: "StockTransfer", column: "receivedByStaffId" },
  { table: "StockTransfer", column: "sentByStaffId" },
  { table: "WorkshopAttachment", column: "uploadedByStaffId" },
  { table: "WorkshopEstimate", column: "createdByStaffId" },
  { table: "WorkshopEstimate", column: "decisionByStaffId" },
  { table: "WorkshopJob", column: "assignedStaffId" },
  { table: "WorkshopJobNote", column: "authorStaffId" },
  { table: "WorkshopMessage", column: "authorStaffId" },
  { table: "WorkshopTimeOff", column: "staffId" },
] as const;

const CONFLICT_AWARE_USER_REFERENCE_TARGETS = [
  { table: "RotaAssignment", column: "staffId", conflictColumns: ["date"] },
  { table: "WorkshopWorkingHours", column: "staffId", conflictColumns: ["dayOfWeek"] },
] as const;

type FixtureMatch = {
  id: string;
  username: string;
  email: string | null;
  createdAt: Date;
};

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
  const usernameMatchers = [fixture.username, ...(fixture.matchUsernames ?? [])].map((username) => username.trim());
  const emailMatchers = [fixture.email, ...(fixture.matchEmails ?? [])].map((email) => email.trim());
  const dedupedMatchers = new Map<string, { username?: string; email?: string }>();

  for (const username of usernameMatchers) {
    if (!username) {
      continue;
    }
    dedupedMatchers.set(`username:${username}`, { username });
  }

  for (const email of emailMatchers) {
    if (!email) {
      continue;
    }
    dedupedMatchers.set(`email:${email}`, { email });
  }

  return [...dedupedMatchers.values()];
};

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

const chooseCanonicalMatch = (fixture: LocalDevStaffFixture, matches: FixtureMatch[]) =>
  matches.find((match) => match.username === fixture.username)
  || matches.find((match) => match.email === fixture.email)
  || matches[0];

const updateUserReference = async (
  tx: Prisma.TransactionClient,
  target: { table: string; column: string },
  fromUserId: string,
  toUserId: string,
) => {
  await tx.$executeRawUnsafe(
    `UPDATE ${quoteIdentifier(target.table)}
     SET ${quoteIdentifier(target.column)} = $1
     WHERE ${quoteIdentifier(target.column)} = $2`,
    toUserId,
    fromUserId,
  );
};

const mergeConflictAwareReference = async (
  tx: Prisma.TransactionClient,
  target: { table: string; column: string; conflictColumns: readonly string[] },
  fromUserId: string,
  toUserId: string,
) => {
  const joinCondition = target.conflictColumns
    .map((column) => `duplicate.${quoteIdentifier(column)} IS NOT DISTINCT FROM canonical.${quoteIdentifier(column)}`)
    .join(" AND ");

  await tx.$executeRawUnsafe(
    `DELETE FROM ${quoteIdentifier(target.table)} AS duplicate
     USING ${quoteIdentifier(target.table)} AS canonical
     WHERE duplicate.${quoteIdentifier(target.column)} = $1
       AND canonical.${quoteIdentifier(target.column)} = $2
       AND ${joinCondition}`,
    fromUserId,
    toUserId,
  );

  await updateUserReference(tx, target, fromUserId, toUserId);
};

const mergeDuplicateUserIntoCanonical = async (
  tx: Prisma.TransactionClient,
  duplicateUserId: string,
  canonicalUserId: string,
) => {
  for (const target of CONFLICT_AWARE_USER_REFERENCE_TARGETS) {
    await mergeConflictAwareReference(tx, target, duplicateUserId, canonicalUserId);
  }

  for (const target of DIRECT_USER_REFERENCE_TARGETS) {
    await updateUserReference(tx, target, duplicateUserId, canonicalUserId);
  }

  await tx.user.delete({
    where: {
      id: duplicateUserId,
    },
  });
};

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: assertLocalDevDatabase(),
  }),
});

const upsertFixture = async (
  tx: Prisma.TransactionClient,
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
      createdAt: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const data = {
    username: fixture.username,
    email: fixture.email,
    name: fixture.name,
    role: fixture.role,
    isTechnician: fixture.isTechnician,
    isActive: fixture.isActive,
    passwordHash,
    pinHash,
  };

  let mergedFrom: FixtureMatch[] = [];
  let canonicalMatch = matches.length > 0 ? chooseCanonicalMatch(fixture, matches) : null;

  if (canonicalMatch) {
    const duplicateMatches = matches.filter((match) => match.id !== canonicalMatch?.id);
    for (const duplicateMatch of duplicateMatches) {
      await mergeDuplicateUserIntoCanonical(tx, duplicateMatch.id, canonicalMatch.id);
    }
    mergedFrom = duplicateMatches;
  }

  if (canonicalMatch) {
    const updated = await tx.user.update({
      where: { id: canonicalMatch.id },
      data,
    });

    return {
      status: mergedFrom.length > 0 ? ("merged" as const) : ("updated" as const),
      user: updated,
      mergedFrom,
    };
  }

  const created = await tx.user.create({ data });
  return { status: "created" as const, user: created, mergedFrom };
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
      `- ${result.status}: ${result.user.name} <${result.user.email}> [${result.user.role}] technician=${result.user.isTechnician} active=${result.user.isActive} PIN ${fixture?.pin ?? "unset"}${result.mergedFrom.length > 0 ? ` merged ${result.mergedFrom.map((entry) => entry.username).join(", ")}` : ""}`,
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
