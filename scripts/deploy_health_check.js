#!/usr/bin/env node

const { setTimeout: sleep } = require("node:timers/promises");

const DEFAULT_BASE_URL = "http://127.0.0.1:3100";

const parsePositiveInteger = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
};

const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");

const baseUrl = normalizeBaseUrl(process.env.COREPOS_DEPLOY_BASE_URL || DEFAULT_BASE_URL);
const requestTimeoutMs = parsePositiveInteger("COREPOS_DEPLOY_REQUEST_TIMEOUT_MS", 5000);
const maxAttempts = parsePositiveInteger("COREPOS_DEPLOY_HEALTH_RETRIES", 45);
const intervalMs = parsePositiveInteger("COREPOS_DEPLOY_HEALTH_INTERVAL_MS", 2000);

const healthUrl = process.env.COREPOS_DEPLOY_HEALTH_URL || `${baseUrl}/health?details=1`;
const versionUrl = process.env.COREPOS_DEPLOY_VERSION_URL || `${baseUrl}/api/system/version`;
const frontendUrl = process.env.COREPOS_DEPLOY_FRONTEND_URL || `${baseUrl}/login`;

const previewBody = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 280 ? `${text.slice(0, 280)}...` : text;
};

const fetchText = async (url) => {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  return {
    status: response.status,
    headers: response.headers,
    body: await response.text(),
  };
};

const parseJson = (label, body) => {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${label} returned non-JSON content: ${previewBody(body)}`);
  }
};

const checks = [
  {
    name: "backend health",
    url: healthUrl,
    run: async () => {
      const response = await fetchText(healthUrl);
      if (response.status !== 200) {
        throw new Error(`expected 200, received ${response.status}: ${previewBody(response.body)}`);
      }

      const json = parseJson("Detailed health check", response.body);
      if (json.status !== "ok") {
        throw new Error(`status=${json.status ?? "unknown"} body=${previewBody(json)}`);
      }
      if (json.checks?.database?.status !== "ok") {
        throw new Error(`database check was ${json.checks?.database?.status ?? "unknown"}`);
      }
      if (json.checks?.migrations?.status !== "ok") {
        throw new Error(`migration check was ${json.checks?.migrations?.status ?? "unknown"}`);
      }

      return `version=${json.app?.version ?? "unknown"} revision=${json.app?.revision ?? "unknown"}`;
    },
  },
  {
    name: "runtime version",
    url: versionUrl,
    run: async () => {
      const response = await fetchText(versionUrl);
      if (response.status !== 200) {
        throw new Error(`expected 200, received ${response.status}: ${previewBody(response.body)}`);
      }

      const json = parseJson("Version endpoint", response.body);
      if (!json.app?.version || !json.app?.revision) {
        throw new Error(`missing app.version/app.revision: ${previewBody(json)}`);
      }

      return `version=${json.app.version} revision=${json.app.revision}`;
    },
  },
  {
    name: "frontend login",
    url: frontendUrl,
    run: async () => {
      const response = await fetchText(frontendUrl);
      if (response.status !== 200) {
        throw new Error(`expected 200, received ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      const looksLikeHtml =
        contentType.includes("text/html") ||
        /<!doctype html/i.test(response.body) ||
        /<html/i.test(response.body);
      if (!looksLikeHtml) {
        throw new Error(`unexpected response content: ${previewBody(response.body)}`);
      }

      return `content-type=${contentType || "unknown"}`;
    },
  },
];

const runChecks = async () => {
  const failures = [];

  for (const check of checks) {
    try {
      const detail = await check.run();
      console.log(`[deploy-health] ${check.name} ok (${detail})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`[deploy-health] ${check.name} failed at ${check.url}: ${message}`);
    }
  }

  return failures;
};

const main = async () => {
  console.log(
    `[deploy-health] Probing CorePOS at ${baseUrl} with up to ${maxAttempts} attempts (${intervalMs}ms interval).`,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const failures = await runChecks();
    if (failures.length === 0) {
      console.log(`[deploy-health] Deployment health checks passed on attempt ${attempt}.`);
      return;
    }

    for (const failure of failures) {
      console.error(`${failure} (attempt ${attempt}/${maxAttempts})`);
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error("Deployment health checks did not pass before the retry budget was exhausted.");
};

main().catch((error) => {
  console.error(`[deploy-health] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
