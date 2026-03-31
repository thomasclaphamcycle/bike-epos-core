#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number.parseInt(process.argv[2] || "", 10);
const pidFile = process.argv[3] ? path.resolve(process.argv[3]) : "";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("Fixture port is required.");
}

if (pidFile) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
}

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end("ok");
    return;
  }

  response.writeHead(200, { "Content-Type": "text/plain" });
  response.end("fixture");
});

const closeAndExit = () => {
  server.close(() => {
    process.exit(0);
  });
};

if (process.env.IGNORE_TERM === "1") {
  process.on("SIGTERM", () => {});
} else {
  process.on("SIGTERM", closeAndExit);
}
process.on("SIGINT", closeAndExit);

server.listen(port, "127.0.0.1");
setInterval(() => {}, 1000);
