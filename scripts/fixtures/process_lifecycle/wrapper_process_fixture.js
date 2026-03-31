#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const port = Number.parseInt(process.argv[2] || "", 10);
const markerDir = process.argv[3] ? path.resolve(process.argv[3]) : "";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("Fixture port is required.");
}
if (!markerDir) {
  throw new Error("Fixture marker directory is required.");
}

fs.mkdirSync(markerDir, { recursive: true });
fs.writeFileSync(path.join(markerDir, "wrapper.pid"), `${process.pid}\n`, "utf8");

const child = spawn(
  process.execPath,
  [
    path.join(__dirname, "server_process_fixture.js"),
    String(port),
    path.join(markerDir, "server.pid"),
  ],
  {
    stdio: "ignore",
    env: process.env,
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

setInterval(() => {}, 1000);
