#!/usr/bin/env node
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const embeddedAssets = require("./embedded-assets.json");

const runtimeDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const defaultConfigPath = path.join(runtimeDir, "corepos-dymo-product-label-agent.config.json");
const configExamplePath = path.join(runtimeDir, "corepos-dymo-product-label-agent.config.example.json");

const parseArgs = (argv) => {
  const args = {
    configPath: defaultConfigPath,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config" || arg === "-c" || arg === "--config-path") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`${arg} requires a path`);
      }
      args.configPath = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }

  return args;
};

const printHelp = () => {
  console.log(`CorePOS Dymo Product Label Agent

Options:
  --config <path>   Use a custom config JSON path
  --help            Show this help message
`);
};

const writeAssetFile = async (filePath, contents) => {
  await fsp.writeFile(filePath, contents, "utf8");
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(options.configPath)) {
    throw new Error(
      `Config file not found at ${options.configPath}. Copy ${configExamplePath} to corepos-dymo-product-label-agent.config.json and edit it before starting the helper.`,
    );
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "corepos-dymo-agent-exe-"));
  const startScriptPath = path.join(tempDir, "Start-CorePOSDymoProductLabelAgent.ps1");
  const printScriptPath = path.join(tempDir, "print_product_label_windows.ps1");

  await writeAssetFile(startScriptPath, embeddedAssets.startScript);
  await writeAssetFile(printScriptPath, embeddedAssets.printScript);

  const cleanup = async () => {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };

  const child = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      startScriptPath,
      "-ConfigPath",
      options.configPath,
    ],
    {
      cwd: runtimeDir,
      stdio: "inherit",
      windowsHide: false,
    },
  );

  const forwardSignal = () => {
    if (!child.killed) {
      child.kill();
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.once("error", async (error) => {
    await cleanup();
    console.error(`[corepos-dymo-agent-exe] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });

  child.once("exit", async (code) => {
    await cleanup();
    process.exit(code ?? 0);
  });
};

main().catch((error) => {
  console.error(`[corepos-dymo-agent-exe] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
