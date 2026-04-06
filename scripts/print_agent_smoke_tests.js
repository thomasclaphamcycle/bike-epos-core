#!/usr/bin/env node
require("dotenv").config({ path: ".env.test" });

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
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
    sharedSecret: "print-agent-smoke-secret",
    dryRunOutputDir: path.resolve(process.cwd(), "tmp", "print-agent-smoke"),
    rawTcpTimeoutMs: 5000,
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
        printerId: "printer-smoke-1",
        printerKey: "DISPATCH_ZEBRA_GK420D",
        printerFamily: "ZEBRA_LABEL",
        printerModelHint: "GK420D_OR_COMPATIBLE",
        printerName: "Dispatch Zebra GK420d",
        transportMode: "RAW_TCP",
        windowsPrinterName: null,
        rawTcpHost: "127.0.0.1",
        rawTcpPort: printerAddress.port,
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
    assert.equal(payload.job.printerId, "printer-smoke-1");
    assert.equal(payload.job.printerKey, "DISPATCH_ZEBRA_GK420D");
    assert.equal(payload.job.printerTarget, `127.0.0.1:${printerAddress.port}`);
    assert.equal(payload.job.copies, 2);

    const received = await printerPayloadPromise;
    const expectedPayload = `${printRequest.document.content}\n${printRequest.document.content}`;
    assert.equal(received, expectedPayload);
    assert.equal(payload.job.bytesSent, Buffer.byteLength(expectedPayload, "utf8"));

    if (process.platform !== "win32") {
      const windowsPrinterRequest = {
        ...printRequest,
        printer: {
          ...printRequest.printer,
          transportMode: "WINDOWS_PRINTER",
          rawTcpHost: null,
          rawTcpPort: null,
          windowsPrinterName: "ZDesigner GK420d",
        },
      };

      const windowsPrinterRes = await fetch(`http://${agent.host}:${agent.port}/jobs/shipment-label`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CorePOS-Print-Agent-Secret": "print-agent-smoke-secret",
        },
        body: JSON.stringify({ printRequest: windowsPrinterRequest }),
      });
      const windowsPrinterPayload = await windowsPrinterRes.json();
      assert.equal(windowsPrinterRes.status, 502, JSON.stringify(windowsPrinterPayload));
      assert.equal(windowsPrinterPayload.error.code, "PRINT_AGENT_TRANSPORT_FAILED");
      assert.match(
        windowsPrinterPayload.error.message,
        /require a Windows host running the CorePOS shipment print helper/i,
      );
    }

    const productLabelRequest = {
      version: 1,
      intentType: "PRODUCT_LABEL_PRINT",
      variantId: "variant-smoke-1",
      printer: {
        transport: "WINDOWS_LOCAL_AGENT",
        printerId: "printer-product-label-1",
        printerKey: "DYMO_PRODUCT_LABEL",
        printerFamily: "DYMO_LABEL",
        printerModelHint: "LABELWRITER_57X32_OR_COMPATIBLE",
        printerName: "Packing Bench Dymo",
        transportMode: "DRY_RUN",
        windowsPrinterName: "DYMO LabelWriter 550",
        copies: 1,
      },
      label: {
        shopName: "CorePOS Cycles",
        productName: "Inner Tube 700x25",
        variantName: "48mm presta",
        brand: "Continental",
        sku: "TUBE-700-48",
        pricePence: 1299,
        barcode: "123456789012",
      },
      document: {
        format: "PNG",
        mimeType: "image/png",
        fileName: "tube-700-48.png",
        bytesBase64:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nm4cAAAAASUVORK5CYII=",
        widthPx: 1,
        heightPx: 1,
      },
      metadata: {
        source: "PRINT_AGENT_SMOKE",
        sourceLabel: "TUBE-700-48",
      },
    };

    const productLabelRes = await fetch(`http://${agent.host}:${agent.port}/jobs/product-label`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CorePOS-Print-Agent-Secret": "print-agent-smoke-secret",
      },
      body: JSON.stringify({ printRequest: productLabelRequest }),
    });
    const productLabelPayload = await productLabelRes.json();
    assert.equal(productLabelRes.status, 201, JSON.stringify(productLabelPayload));
    assert.equal(productLabelPayload.ok, true);
    assert.equal(productLabelPayload.job.transportMode, "DRY_RUN");
    assert.equal(productLabelPayload.job.simulated, true);
    assert.equal(productLabelPayload.job.printerId, "printer-product-label-1");
    assert.equal(productLabelPayload.job.printerKey, "DYMO_PRODUCT_LABEL");
    assert.equal(productLabelPayload.job.printerTarget, "dry-run:" + path.resolve(process.cwd(), "tmp", "print-agent-smoke", "product-labels"));
    assert.equal(productLabelPayload.job.documentFormat, "DYMO_PRODUCT_LABEL");
    assert.equal(productLabelPayload.job.outputPath.endsWith(".png"), true);
    assert.equal(productLabelPayload.job.bytesSent > 0, true);

    const renderedLabel = await fs.readFile(productLabelPayload.job.outputPath);
    assert.equal(renderedLabel.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
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
