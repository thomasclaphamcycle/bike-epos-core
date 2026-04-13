#!/usr/bin/env node

const HEALTH_URL = "http://127.0.0.1:3000/health";
const REQUEST_TIMEOUT_MS = 3000;

const timestamp = () => new Date().toISOString();

const sendSlackAlert = async () => {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    throw new Error("SLACK_WEBHOOK_URL is required to send a health alert");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: `[ALERT] CorePOS health check FAILED\nTimestamp: ${timestamp()}`,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook responded with status ${response.status}`);
  }
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
  try {
    await checkHealth();
  } catch (error) {
    try {
      await sendSlackAlert();
    } catch (slackError) {
      console.error(`[health-monitor] failed to send Slack alert: ${slackError.message}`);
    }

    console.error(`[health-monitor] health check failed at ${timestamp()}: ${error.message}`);
    process.exitCode = 1;
  }
};

void main();
