#!/usr/bin/env node
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(repoRoot, 'package.json'));
const sourceDir = path.join(repoRoot, 'print-agent', 'windows-zebra-agent');
const launcherPath = path.join(sourceDir, 'corepos-zebra-shipment-agent-launcher.js');
const readmePath = path.join(sourceDir, 'README.txt');
const configExamplePath = path.join(sourceDir, 'corepos-zebra-shipment-agent.config.example.json');
const startScriptPath = path.join(sourceDir, 'Start-CorePOSZebraShipmentAgent.ps1');
const printScriptPath = path.join(repoRoot, 'print-agent', 'scripts', 'print_shipment_label_windows.ps1');
const defaultOutDir = path.join(repoRoot, 'tmp', 'zebra-shipment-agent-bundle', `corepos-zebra-shipment-agent-v${packageJson.version}`);
const defaultBuildDir = path.join(repoRoot, 'tmp', 'zebra-shipment-agent-build', `corepos-zebra-shipment-agent-v${packageJson.version}`);
const defaultTarget = 'node18-win-x64';

const executableFileName = 'corepos-zebra-shipment-agent.exe';
const layoutOnlyNoteFileName = 'exe-build-skipped.txt';

const parseArgs = (argv) => {
  const args = {
    outDir: defaultOutDir,
    buildDir: defaultBuildDir,
    target: defaultTarget,
    skipExeBuild: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--out-dir requires a path');
      }
      args.outDir = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === '--build-dir') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--build-dir requires a path');
      }
      args.buildDir = path.resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === '--target') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('--target requires a value');
      }
      args.target = next;
      index += 1;
      continue;
    }
    if (arg === '--skip-exe-build' || arg === '--layout-only') {
      args.skipExeBuild = true;
    }
  }
  return args;
};

const runPkgBuild = (entryPath, outputPath, target) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['pkg', entryPath, '--target', target, '--output', outputPath],
      {
        cwd: repoRoot,
        stdio: 'inherit',
      },
    );

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pkg exited with code ${code}`));
    });
  });

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const manifest = {
    name: 'corepos-zebra-shipment-agent',
    version: packageJson.version,
    createdAt: new Date().toISOString(),
    target: options.target,
    runtimeFiles: [
      executableFileName,
      'corepos-zebra-shipment-agent.config.example.json',
      'README.txt',
    ],
    buildMode: options.skipExeBuild ? 'layout-only' : 'exe',
  };

  await fs.rm(options.outDir, { recursive: true, force: true });
  await fs.rm(options.buildDir, { recursive: true, force: true });
  await fs.mkdir(options.outDir, { recursive: true });

  await fs.copyFile(readmePath, path.join(options.outDir, 'README.txt'));
  await fs.copyFile(
    configExamplePath,
    path.join(options.outDir, 'corepos-zebra-shipment-agent.config.example.json'),
  );

  if (options.skipExeBuild) {
    await fs.writeFile(
      path.join(options.outDir, layoutOnlyNoteFileName),
      [
        'The Windows EXE build was intentionally skipped for this packaging run.',
        'Re-run npm run print-agent:package:zebra without --skip-exe-build on a packaging machine to generate corepos-zebra-shipment-agent.exe.',
        '',
      ].join('\n'),
      'utf8',
    );
  } else {
    await fs.mkdir(options.buildDir, { recursive: true });
    const [launcherSource, startScript, printScript] = await Promise.all([
      fs.readFile(launcherPath, 'utf8'),
      fs.readFile(startScriptPath, 'utf8'),
      fs.readFile(printScriptPath, 'utf8'),
    ]);

    const embeddedAssetsPath = path.join(options.buildDir, 'embedded-assets.json');
    const launcherBuildPath = path.join(options.buildDir, 'corepos-zebra-shipment-agent-launcher.js');

    await Promise.all([
      fs.writeFile(launcherBuildPath, launcherSource, 'utf8'),
      fs.writeFile(
        embeddedAssetsPath,
        JSON.stringify(
          {
            startScript,
            printScript,
          },
          null,
          2,
        ) + '\n',
        'utf8',
      ),
    ]);

    await runPkgBuild(
      launcherBuildPath,
      path.join(options.outDir, executableFileName),
      options.target,
    );
  }

  await fs.writeFile(
    path.join(options.outDir, 'bundle-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );

  await fs.rm(options.buildDir, { recursive: true, force: true }).catch(() => undefined);

  console.log(`[zebra-agent-package] Bundle ready at ${options.outDir}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
