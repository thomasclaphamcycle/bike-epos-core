#!/usr/bin/env node
require('dotenv').config({ path: '.env.test' });

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(repoRoot, 'package.json'));
const outDir = path.join(repoRoot, 'tmp', 'dymo-product-label-agent-bundle-smoke');

const runPackager = () =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/package_dymo_product_label_agent.js', '--out-dir', outDir, '--skip-exe-build'],
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
      reject(new Error(`Packager exited with code ${code}`));
    });
  });

const run = async () => {
  await fs.rm(outDir, { recursive: true, force: true });
  try {
    await runPackager();

    const expectedFiles = [
      'corepos-dymo-product-label-agent.config.example.json',
      'README.txt',
      'exe-build-skipped.txt',
      'bundle-manifest.json',
    ];

    for (const fileName of expectedFiles) {
      await fs.access(path.join(outDir, fileName));
    }

    const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'bundle-manifest.json'), 'utf8'));
    assert.equal(manifest.name, 'corepos-dymo-product-label-agent');
    assert.equal(manifest.version, packageJson.version);
    assert.equal(manifest.buildMode, 'layout-only');
    assert.equal(manifest.target, 'node18-win-x64');
    assert.deepEqual(manifest.runtimeFiles, [
      'corepos-dymo-product-label-agent.exe',
      'corepos-dymo-product-label-agent.config.example.json',
      'README.txt',
    ]);

    const readme = await fs.readFile(path.join(outDir, 'README.txt'), 'utf8');
    assert.match(readme, /does not require the CorePOS repo checkout or npm/i);
    assert.match(readme, /corepos-dymo-product-label-agent\.exe/i);
    assert.match(readme, /COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL/);

    const configExample = JSON.parse(
      await fs.readFile(path.join(outDir, 'corepos-dymo-product-label-agent.config.example.json'), 'utf8'),
    );
    assert.equal(configExample.port, 3212);
    assert.equal(configExample.bindHost, '127.0.0.1');

    console.log('dymo product-label agent exe packaging layout passed');
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
