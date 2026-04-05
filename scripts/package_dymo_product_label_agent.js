#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(repoRoot, 'package.json'));
const sourceDir = path.join(repoRoot, 'print-agent', 'windows-dymo-agent');
const printScriptPath = path.join(repoRoot, 'print-agent', 'scripts', 'print_product_label_windows.ps1');
const defaultOutDir = path.join(repoRoot, 'tmp', 'dymo-product-label-agent-bundle', `corepos-dymo-product-label-agent-v${packageJson.version}`);

const parseArgs = (argv) => {
  const args = { outDir: defaultOutDir };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--out-dir requires a path');
      }
      args.outDir = path.resolve(process.cwd(), next);
      index += 1;
    }
  }
  return args;
};

const copyDir = async (fromDir, toDir) => {
  await fs.mkdir(toDir, { recursive: true });
  const entries = await fs.readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(fromDir, entry.name);
    const targetPath = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      continue;
    }
    await fs.copyFile(sourcePath, targetPath);
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  await fs.rm(options.outDir, { recursive: true, force: true });
  await copyDir(sourceDir, options.outDir);
  await fs.copyFile(printScriptPath, path.join(options.outDir, 'print_product_label_windows.ps1'));
  await fs.writeFile(
    path.join(options.outDir, 'bundle-manifest.json'),
    JSON.stringify(
      {
        name: 'corepos-dymo-product-label-agent',
        version: packageJson.version,
        createdAt: new Date().toISOString(),
        files: [
          'Start-CorePOSDymoProductLabelAgent.ps1',
          'corepos-dymo-product-label-agent.cmd',
          'corepos-dymo-product-label-agent.config.example.json',
          'print_product_label_windows.ps1',
          'README.txt',
        ],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(`[dymo-agent-package] Bundle ready at ${options.outDir}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
