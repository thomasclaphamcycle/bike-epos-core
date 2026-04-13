#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const HEALTH_URL = process.env.COREPOS_HEALTH_URL || "http://127.0.0.1:3000/health?details=1";
const REQUEST_TIMEOUT_MS = 3000;
const STATE_HEALTHY = "HEALTHY";
const STATE_UNHEALTHY = "UNHEALTHY";
const DEFAULT_STATE_PATH = "C:\\CorePOS\\.corepos-runtime\\health-state.json";

const timestamp = () => new Date().toISOString();
const stateFilePath = process.env.COREPOS_HEALTH_STATE_PATH || DEFAULT_STATE_PATH;

const sendSlackAlert = async (message) => {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("[health-monitor] SLACK_WEBHOOK_URL not set; skipping Slack notification");
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: `${message}\nTimestamp: ${timestamp()}`,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook responded with status ${response.status}`);
  }
};

const readPreviousState = async () => {
  try {
    const raw = await fs.readFile(stateFilePath, "utf8");
    const parsed = JSON.parse(raw);

    if (parsed?.state === STATE_HEALTHY || parsed?.state === STATE_UNHEALTHY) {
      return parsed.state;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`[health-monitor] failed to read state file, assuming ${STATE_HEALTHY}: ${error.message}`);
    }
  }

  return STATE_HEALTHY;
};

const writeState = async (state) => {
  const parentDir = path.dirname(stateFilePath);
  await fs.mkdir(parentDir, { recursive: true });
  await fs.writeFile(
    stateFilePath,
    JSON.stringify(
      {
        state,
        updatedAt: timestamp(),
      },
      null,
      2,
    ),
  );
};

const checkHealth = async () => {
  const response = await fetch(HEALTH_URL, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Health endpoint responded with status ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.status !== "ok") {
    throw new Error("Health endpoint did not return status ok");
  }
};

const main = async () => {
  const previousState = await readPreviousState();
  console.log(`[health-monitor] previous state: ${previousState}`);

  try {
    await checkHealth();

    const nextState = STATE_HEALTHY;
    console.log(`[health-monitor] current state: ${nextState}`);

    if (previousState === STATE_UNHEALTHY) {
      console.log("[health-monitor] sending recovery alert");
      await sendSlackAlert("[RECOVERY] CorePOS is back online");
    }

    await writeState(nextState);
  } catch (error) {
    const nextState = STATE_UNHEALTHY;
    console.log(`[health-monitor] current state: ${nextState}`);

    try {
      if (previousState === STATE_HEALTHY) {
        console.log("[health-monitor] sending failure alert");
        await sendSlackAlert("[ALERT] CorePOS health check FAILED");
      }
    } catch (slackError) {
      console.error(`[health-monitor] failed to send Slack alert: ${slackError.message}`);
    }

    await writeState(nextState);
    console.error(`[health-monitor] health check failed at ${timestamp()}: ${error.message}`);
    process.exitCode = 1;
  }
};

void main();
