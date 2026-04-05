#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const formatDuration = (durationMs) => {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1)}s`;
};

const formatCommand = (step) => [step.command, ...step.args].join(" ");

const verifySteps = [
  {
    label: "prisma:generate",
    command: npmCommand,
    args: ["run", "prisma:generate"],
  },
  {
    label: "test",
    command: npmCommand,
    args: ["test"],
    env: { NODE_ENV: "test" },
  },
  {
    label: "build",
    command: npmCommand,
    args: ["run", "build"],
  },
  {
    label: "e2e",
    command: npmCommand,
    args: ["run", "e2e"],
    env: { NODE_ENV: "test" },
  },
  {
    label: "test:m38",
    command: npmCommand,
    args: ["run", "test:m38"],
    env: { NODE_ENV: "test" },
  },
  {
    label: "test:m24",
    command: npmCommand,
    args: ["run", "test:m24"],
    env: { NODE_ENV: "test" },
  },
  {
    label: "test:m27",
    command: npmCommand,
    args: ["run", "test:m27"],
    env: { NODE_ENV: "test" },
  },
  {
    label: "test:m30",
    command: npmCommand,
    args: ["run", "test:m30"],
    env: { NODE_ENV: "test" },
  },
  {
    label: "test:m83",
    command: npmCommand,
    args: ["run", "test:m83"],
    env: { NODE_ENV: "test" },
  },
  {
    label: "db:seed:dev",
    command: npmCommand,
    args: ["run", "db:seed:dev"],
  },
];

const runStep = (step) => {
  const startedAt = Date.now();
  console.log(`[verify] Running ${step.label}: ${formatCommand(step)}`);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      ...(step.env || {}),
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number") {
    const durationMs = Date.now() - startedAt;
    if (result.status === 0) {
      console.log(`[verify] Completed ${step.label} in ${formatDuration(durationMs)}`);
    } else {
      console.error(
        `[verify] ${step.label} failed with exit code ${result.status} after ${formatDuration(durationMs)}`,
      );
    }
    return {
      exitCode: result.status,
      durationMs,
      signal: null,
    };
  }

  if (result.signal) {
    const durationMs = Date.now() - startedAt;
    console.error(
      `[verify] ${step.label} exited via ${result.signal} after ${formatDuration(durationMs)}`,
    );
    return {
      exitCode: 1,
      durationMs,
      signal: result.signal,
    };
  }

  const durationMs = Date.now() - startedAt;
  console.error(`[verify] ${step.label} exited unexpectedly after ${formatDuration(durationMs)}`);
  return {
    exitCode: 1,
    durationMs,
    signal: null,
  };
};

const main = () => {
  let verifyExitCode = 0;
  let failedStep = null;
  const verifyStartedAt = Date.now();

  try {
    for (const step of verifySteps) {
      const result = runStep(step);
      verifyExitCode = result.exitCode;
      if (verifyExitCode !== 0) {
        failedStep = {
          label: step.label,
          command: formatCommand(step),
          ...result,
        };
        break;
      }
    }
  } finally {
    const postflightResult = runStep({
      label: "verify:postflight",
      command: npmCommand,
      args: ["run", "verify:postflight"],
    });
    const postflightExitCode = postflightResult.exitCode;

    if (verifyExitCode === 0) {
      verifyExitCode = postflightExitCode;
      if (postflightExitCode !== 0) {
        failedStep = {
          label: "verify:postflight",
          command: `${npmCommand} run verify:postflight`,
          ...postflightResult,
        };
      }
    }
  }

  const totalDurationMs = Date.now() - verifyStartedAt;
  if (verifyExitCode === 0) {
    console.log(`[verify] Verification passed in ${formatDuration(totalDurationMs)}`);
  } else if (failedStep) {
    console.error(
      `[verify] Verification failed at ${failedStep.label} after ${formatDuration(totalDurationMs)} (${failedStep.command})`,
    );
  } else {
    console.error(`[verify] Verification failed after ${formatDuration(totalDurationMs)}`);
  }

  process.exit(verifyExitCode);
};

main();
