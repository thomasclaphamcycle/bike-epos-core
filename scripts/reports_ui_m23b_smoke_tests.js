#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { URLSearchParams } = require("node:url");

if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing to run: NODE_ENV must be 'test'.");
}

if (typeof Response === "undefined" || typeof Blob === "undefined" || typeof Headers === "undefined") {
  throw new Error("This script requires Node.js with global fetch/Response/Blob support.");
}

const PROJECT_ROOT = path.resolve(__dirname, "..");
console.log(`[m23b-ui-smoke] NODE_ENV=${process.env.NODE_ENV}`);

const toJsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });

const toCsvResponse = (body, filename) =>
  new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });

const getAttribute = (attrs, name) => {
  const regex = new RegExp(`${name}="([^"]*)"`, "i");
  const match = attrs.match(regex);
  return match ? match[1] : null;
};

class MockClassList {
  constructor(classes = []) {
    this._set = new Set(classes);
  }

  add(...classes) {
    classes.forEach((value) => this._set.add(value));
  }

  remove(...classes) {
    classes.forEach((value) => this._set.delete(value));
  }

  contains(value) {
    return this._set.has(value);
  }
}

class MockElement {
  constructor({ id = null, tagName = "div", classes = [], attributes = {} }) {
    this.id = id;
    this.tagName = tagName.toLowerCase();
    this.classList = new MockClassList(classes);
    this.attributes = { ...attributes };
    this.dataset = {};
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.listeners = new Map();
    this.focused = false;
    this.scrolled = false;
    this._innerHTML = "";
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? "");
    if (this.tagName === "select") {
      const firstOptionValue = this._innerHTML.match(/<option value="([^"]*)"/i)?.[1];
      this.value = firstOptionValue ?? "";
    }
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
  }

  dispatchEvent(type) {
    const handlers = this.listeners.get(type) || [];
    const event = { currentTarget: this, target: this };
    handlers.forEach((handler) => handler(event));
  }

  click() {
    if (this.disabled) {
      return;
    }
    this.dispatchEvent("click");
  }

  focus() {
    this.focused = true;
  }

  scrollIntoView() {
    this.scrolled = true;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

class MockDocument {
  constructor() {
    this.elementsById = new Map();
    this.elementsByClass = new Map();
    this.bodyChildren = [];
    this.body = new MockElement({ tagName: "body" });
    this.body.appendChild = (element) => {
      this.bodyChildren.push(element);
    };
    this.body.removeChild = (element) => {
      this.bodyChildren = this.bodyChildren.filter((entry) => entry !== element);
    };
  }

  registerElement(element) {
    if (element.id) {
      this.elementsById.set(element.id, element);
    }
    Object.keys(element.attributes).forEach((key) => {
      if (key.startsWith("data-")) {
        const datasetKey = key
          .slice(5)
          .replace(/-([a-z])/g, (_, chr) => chr.toUpperCase());
        element.dataset[datasetKey] = element.attributes[key];
      }
    });
  }

  registerClass(element, className) {
    if (!this.elementsByClass.has(className)) {
      this.elementsByClass.set(className, []);
    }
    this.elementsByClass.get(className).push(element);
  }

  querySelector(selector) {
    if (selector.startsWith("#")) {
      return this.elementsById.get(selector.slice(1)) ?? null;
    }
    if (selector.startsWith(".")) {
      const entries = this.elementsByClass.get(selector.slice(1)) || [];
      return entries[0] ?? null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector.startsWith(".")) {
      return [...(this.elementsByClass.get(selector.slice(1)) || [])];
    }
    return [];
  }

  createElement(tagName) {
    return new MockElement({ tagName });
  }
}

const buildDocumentFromHtml = (html) => {
  const document = new MockDocument();
  const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>/g;
  let match = null;
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrs = match[2] || "";
    const id = getAttribute(attrs, "id");
    const classAttr = getAttribute(attrs, "class");
    if (!id && !classAttr) {
      continue;
    }
    const classes = classAttr ? classAttr.split(/\s+/).filter(Boolean) : [];
    const attributes = {};
    const dataTab = getAttribute(attrs, "data-tab");
    if (dataTab) {
      attributes["data-tab"] = dataTab;
    }

    const element = new MockElement({
      id,
      tagName,
      classes,
      attributes,
    });
    document.registerElement(element);
    classes.forEach((className) => document.registerClass(element, className));
  }
  return document;
};

const compileReportsPageRenderer = () => {
  const sourcePath = path.join(PROJECT_ROOT, "src/views/reportsPage.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  });
  const module = { exports: {} };
  const wrapper = `(function(require, module, exports) {\n${transpiled.outputText}\n})`;
  const compiledFactory = vm.runInThisContext(wrapper, {
    filename: sourcePath,
  });
  compiledFactory(require, module, module.exports);
  if (typeof module.exports.renderReportsPage !== "function") {
    throw new Error("Could not load renderReportsPage from src/views/reportsPage.ts");
  }
  return module.exports.renderReportsPage;
};

const extractInlineScript = (html) => {
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>/i);
  if (!match?.[1]) {
    throw new Error("Could not find inline script in reports page HTML.");
  }
  return match[1];
};

const createFetchMock = () => {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const normalizedUrl = String(url);
    calls.push({
      url: normalizedUrl,
      options,
    });

    if (normalizedUrl.startsWith("/api/locations")) {
      return toJsonResponse({
        locations: [{ id: "loc-1", name: "Clapham", isDefault: true }],
      });
    }

    if (normalizedUrl.startsWith("/api/reports/sales/daily.csv")) {
      return toCsvResponse("date,saleCount,grossPence,refundsPence,netPence\n2026-03-01,1,1000,0,1000\n", "sales_daily.csv");
    }

    if (normalizedUrl.startsWith("/api/reports/workshop/daily.csv")) {
      return toCsvResponse("date,jobCount,revenuePence\n2026-03-01,2,2500\n", "workshop_daily.csv");
    }

    if (normalizedUrl.startsWith("/api/reports/inventory/on-hand.csv")) {
      return toCsvResponse("variantId,productName,option,barcode,onHand\nv1,Tyre,700x25,ABC,4\n", "inventory_on_hand.csv");
    }

    if (normalizedUrl.startsWith("/api/reports/inventory/value.csv")) {
      return toCsvResponse("variantId,onHand,avgUnitCostPence,valuePence\nv1,4,250,1000\n", "inventory_value.csv");
    }

    if (normalizedUrl.startsWith("/api/reports/sales/daily")) {
      return toJsonResponse([]);
    }
    if (normalizedUrl.startsWith("/api/reports/workshop/daily")) {
      return toJsonResponse([]);
    }
    if (normalizedUrl.startsWith("/api/reports/inventory/on-hand")) {
      return toJsonResponse([]);
    }
    if (normalizedUrl.startsWith("/api/reports/inventory/value")) {
      return toJsonResponse({
        locationId: "loc-1",
        totalOnHand: 0,
        totalValuePence: 0,
        method: "PURCHASE_COST_AVG_V1",
        countMissingCost: 0,
        breakdown: [],
      });
    }

    return toJsonResponse({ error: { message: "Not found" } }, 404);
  };

  return { fetch, calls };
};

const flushAsync = async () => {
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const run = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
    return true;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error?.message || String(error));
    return false;
  }
};

const main = async () => {
  const renderReportsPage = compileReportsPageRenderer();
  const html = renderReportsPage({
    staffRole: "MANAGER",
    staffId: "m23b-smoke",
  });

  const document = buildDocumentFromHtml(html);
  const { fetch, calls } = createFetchMock();
  const blobUrls = [];

  const context = {
    console,
    document,
    fetch,
    Blob,
    Response,
    Headers,
    URLSearchParams,
    Promise,
    setTimeout,
    clearTimeout,
    URL: {
      createObjectURL: () => {
        const value = `blob:mock-${blobUrls.length + 1}`;
        blobUrls.push(value);
        return value;
      },
      revokeObjectURL: () => {},
    },
  };
  context.window = context;

  const scriptSource = extractInlineScript(html);
  vm.runInNewContext(scriptSource, context, {
    filename: "reportsPage.inline.js",
  });
  await flushAsync();

  const qs = (id) => document.querySelector(`#${id}`);
  const setField = (id, value, eventName) => {
    const element = qs(id);
    assert(element, `Missing element #${id}`);
    element.value = value;
    if (eventName) {
      element.dispatchEvent(eventName);
    }
  };

  const clickAndGetCsvCall = async (id) => {
    const button = qs(id);
    assert(button, `Missing element #${id}`);
    const before = calls.length;
    button.click();
    await flushAsync();
    const newCalls = calls.slice(before);
    const csvCalls = newCalls.filter((entry) => entry.url.includes(".csv"));
    return {
      newCalls,
      csvCalls,
      csvCall: csvCalls[0] || null,
    };
  };

  const expectMatchingExportCalls = async ({
    label,
    controlButtonId,
    headerButtonId,
    expectedUrl,
  }) => {
    const controlResult = await clickAndGetCsvCall(controlButtonId);
    const headerResult = await clickAndGetCsvCall(headerButtonId);

    assert(controlResult.csvCall, `${label}: control export did not issue CSV request.`);
    assert(headerResult.csvCall, `${label}: header export did not issue CSV request.`);
    assert(
      controlResult.csvCall.url === expectedUrl,
      `${label}: unexpected control URL ${controlResult.csvCall.url}`,
    );
    assert(
      headerResult.csvCall.url === expectedUrl,
      `${label}: unexpected header URL ${headerResult.csvCall.url}`,
    );

    const controlHeaders = controlResult.csvCall.options?.headers || {};
    const headerHeaders = headerResult.csvCall.options?.headers || {};
    assert(
      JSON.stringify(controlHeaders) === JSON.stringify(headerHeaders),
      `${label}: control/header headers differ.`,
    );
    assert(controlHeaders["X-Staff-Role"] === "MANAGER", `${label}: missing manager role header.`);
    assert(controlHeaders["X-Staff-Id"] === "m23b-smoke", `${label}: missing staff id header.`);
  };

  setField("sales-from", "2026-03-01", "input");
  setField("sales-to", "2026-03-05", "input");
  setField("workshop-from", "2026-03-01", "input");
  setField("workshop-to", "2026-03-05", "input");
  setField("onhand-location", "loc-1", "change");
  setField("value-location", "loc-1", "change");
  await flushAsync();

  const results = [];
  results.push(
    await run("sales header/control export URLs and headers match", async () => {
      await expectMatchingExportCalls({
        label: "sales",
        controlButtonId: "sales-export",
        headerButtonId: "sales-table-export",
        expectedUrl: "/api/reports/sales/daily.csv?from=2026-03-01&to=2026-03-05",
      });
    }),
  );

  results.push(
    await run("workshop header/control export URLs and headers match", async () => {
      await expectMatchingExportCalls({
        label: "workshop",
        controlButtonId: "workshop-export",
        headerButtonId: "workshop-table-export",
        expectedUrl: "/api/reports/workshop/daily.csv?from=2026-03-01&to=2026-03-05",
      });
    }),
  );

  results.push(
    await run("on-hand header/control export URLs and headers match", async () => {
      await expectMatchingExportCalls({
        label: "onhand",
        controlButtonId: "onhand-export",
        headerButtonId: "onhand-table-export",
        expectedUrl: "/api/reports/inventory/on-hand.csv?locationId=loc-1",
      });
    }),
  );

  results.push(
    await run("inventory value header/control export URLs and headers match", async () => {
      await expectMatchingExportCalls({
        label: "value",
        controlButtonId: "value-export",
        headerButtonId: "value-table-export",
        expectedUrl: "/api/reports/inventory/value.csv?locationId=loc-1",
      });
    }),
  );

  results.push(
    await run("invalid sales filters block export request", async () => {
      setField("sales-from", "", "input");
      setField("sales-to", "2026-03-05", "input");
      await flushAsync();
      const before = calls.length;
      qs("sales-table-export").click();
      await flushAsync();
      const csvCalls = calls.slice(before).filter((entry) => entry.url.includes(".csv"));
      assert(csvCalls.length === 0, "Sales export should be blocked when from date is missing.");

      // Restore valid values for any future runs.
      setField("sales-from", "2026-03-01", "input");
      await flushAsync();
    }),
  );

  results.push(
    await run("missing on-hand location blocks export and focuses location", async () => {
      setField("onhand-location", "", "change");
      await flushAsync();
      const before = calls.length;
      qs("onhand-table-export").click();
      await flushAsync();
      const csvCalls = calls.slice(before).filter((entry) => entry.url.includes(".csv"));
      assert(csvCalls.length === 0, "On-hand export should be blocked when location is missing.");
      assert(
        qs("onhand-location").focused || qs("onhand-location").scrolled,
        "On-hand location was not focused/scrolled.",
      );
      setField("onhand-location", "loc-1", "change");
      await flushAsync();
    }),
  );

  const passed = results.filter(Boolean).length;
  if (passed !== results.length) {
    throw new Error(`${results.length - passed} of ${results.length} M23B UI smoke test(s) failed.`);
  }

  console.log(`\nAll ${results.length} M23B UI smoke test(s) passed.`);
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
