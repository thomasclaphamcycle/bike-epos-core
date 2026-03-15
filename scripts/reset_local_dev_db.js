#!/usr/bin/env node
require("dotenv/config");

const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const targetUrl = new URL(DATABASE_URL);
const host = targetUrl.hostname;
const databaseName = targetUrl.pathname.replace(/^\//, "");

if (!["localhost", "127.0.0.1"].includes(host)) {
  console.error(`Refusing to reset non-local database host: ${host}`);
  process.exit(1);
}

if (!databaseName) {
  console.error("DATABASE_URL must include a database name.");
  process.exit(1);
}

if (["postgres", "template0", "template1"].includes(databaseName)) {
  console.error(`Refusing to reset reserved database: ${databaseName}`);
  process.exit(1);
}

const adminUrl = new URL(DATABASE_URL);
adminUrl.pathname = "/postgres";

const quotedDatabaseName = `"${databaseName.replace(/"/g, "\"\"")}"`;

const run = async () => {
  const client = new Client({ connectionString: adminUrl.toString() });

  try {
    await client.connect();
    await client.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName}`);
    await client.query(`CREATE DATABASE ${quotedDatabaseName}`);
    console.log(`Reset local database: ${databaseName}`);
    console.log("Next steps:");
    console.log("  npm run db:reset-and-seed:dev");
    console.log("or run manually:");
    console.log("  npx prisma migrate dev");
    console.log("  npm run db:seed:dev");
    console.log("  npm run auth:seed-admin");
    console.log("  npm run auth:seed-local-staff");
  } finally {
    await client.end().catch(() => {});
  }
};

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
