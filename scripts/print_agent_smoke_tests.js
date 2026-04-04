#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { register } = require("ts-node");

if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}

register({ transpileOnly: true });

const { startPrintAgentServer } = require(path.join(__dirname, "..", "print-agent", "src", "app.ts"));

const listen = (server, host = "127.0.0.1") =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      resolve(server.address());
    });
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

const run = async () => {
  const printerConnections = [];
  let resolvePrinterPayload;
  const printerPayloadPromise = new Promise((resolve) => {
    resolvePrinterPayload = resolve;
  });
  const printerServer = net.createServer((socket) => {
    const chunks = [];
    socket.on("data", (chunk) => {
      chunks.push(chunk);
    });
    socket.on("end", () => {
      resolvePrinterPayload(Buffer.concat(chunks).toString("utf8"));
    });
    printerConnections.push(socket);
  });
  const printerAddress = await listen(printerServer);
  const agent = await startPrintAgentServer({
    bindHost: "127.0.0.1",
    port: 0,
    transportMode: "RAW_TCP",
    sharedSecret: "print-agent-smoke-secret",
    defaultPrinterName: "Smoke Zebra GK420d",
    dryRunOutputDir: path.resolve(process.cwd(), "tmp", "print-agent-smoke"),
    rawTcp: {
      host: "127.0.0.1",
      port: printerAddress.port,
      timeoutMs: 5000,
    },
  });

  try {
    const printRequest = {
      version: 1,
      intentType: "SHIPMENT_LABEL_PRINT",
      shipmentId: "shipment-smoke-1",
      orderId: "order-smoke-1",
      orderNumber: "WEB-SMOKE-PRINT-1",
      trackingNumber: "MOCKTRACK001",
      printer: {
        transport: "WINDOWS_LOCAL_AGENT",
        printerFamily: "ZEBRA_LABEL",
        printerModelHint: "GK420D_OR_COMPATIBLE",
        printerName: "Dispatch Zebra GK420d",
        copies: 2,
      },
      document: {
        format: "ZPL",
        mimeType: "application/zpl",
        fileName: "shipment-smoke.zpl",
        content: "^XA\n^FO36,36^FDHELLO COREPOS^FS\n^XZ",
      },
      metadata: {
        providerKey: "INTERNAL_MOCK_ZPL",
        providerDisplayName: "Internal Mock ZPL",
        serviceCode: "STANDARD",
        serviceName: "Standard Dispatch",
        sourceChannel: "INTERNAL_MOCK_WEB_STORE",
      },
    };

    const unauthorizedRes = await fetch(`http://${agent.host}:${agent.port}/jobs/shipment-label`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ printRequest }),
    });
    assert.equal(unauthorizedRes.status, 401);

    const invalidRes = await fetch(`http://${agent.host}:${agent.port}/jobs/shipment-label`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CorePOS-Print-Agent-Secret": "print-agent-smoke-secret",
      },
      body: JSON.stringify({ printRequest: { ...printRequest, document: { ...printRequest.document, format: "PDF" } } }),
    });
    assert.equal(invalidRes.status, 400);

    const response = await fetch(`http://${agent.host}:${agent.port}/jobs/shipment-label`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CorePOS-Print-Agent-Secret": "print-agent-smoke-secret",
      },
      body: JSON.stringify({ printRequest }),
    });
    const payload = await response.json();
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    assert.equal(payload.job.transportMode, "RAW_TCP");
    assert.equal(payload.job.simulated, false);
    assert.equal(payload.job.printerTarget, `127.0.0.1:${printerAddress.port}`);
    assert.equal(payload.job.copies, 2);

    const received = await printerPayloadPromise;
    const expectedPayload = `${printRequest.document.content}\n${printRequest.document.content}`;
    assert.equal(received, expectedPayload);
    assert.equal(payload.job.bytesSent, Buffer.byteLength(expectedPayload, "utf8"));
  } finally {
    for (const socket of printerConnections) {
      socket.destroy();
    }
    await Promise.allSettled([
      agent.close(),
      closeServer(printerServer),
    ]);
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
