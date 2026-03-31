#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

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
  console.log(`[verify] Running ${step.label}`);
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
    return result.status;
  }

  if (result.signal) {
    console.error(`[verify] ${step.label} exited via ${result.signal}`);
    return 1;
  }

  return 1;
};

const main = () => {
  let verifyExitCode = 0;

  try {
    for (const step of verifySteps) {
      verifyExitCode = runStep(step);
      if (verifyExitCode !== 0) {
        break;
      }
    }
  } finally {
    const postflightExitCode = runStep({
      label: "verify:postflight",
      command: npmCommand,
      args: ["run", "verify:postflight"],
    });

    if (verifyExitCode === 0) {
      verifyExitCode = postflightExitCode;
    }
  }

  process.exit(verifyExitCode);
};

main();
