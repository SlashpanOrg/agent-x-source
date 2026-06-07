#!/usr/bin/env node

/**
 * Sync version from the single source of truth (packages/shared/src/constants/version.ts)
 * to all package.json files that need it.
 *
 * Usage:
 *   node scripts/sync-version.mjs          # Sync version.ts → all package.json files
 *   node scripts/sync-version.mjs --check  # Check if they match (CI gate)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Read version from version.ts (single source of truth)
const versionTsPath = resolve(root, 'packages/shared/src/constants/version.ts');
const versionTs = readFileSync(versionTsPath, 'utf-8');
const match = versionTs.match(/VERSION\s*=\s*'([^']+)'/);
if (!match) {
  console.error('Could not parse VERSION from packages/shared/src/constants/version.ts');
  process.exit(1);
}
const sourceVersion = match[1];

const checkOnly = process.argv.includes('--check');

// All package.json files that must stay in sync
const pkgPaths = [
  resolve(root, 'package.json'),
  resolve(root, 'packages/desktop/package.json'),
];

let mismatch = false;

for (const pkgPath of pkgPaths) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const pkgVersion = pkg.version;

  if (sourceVersion === pkgVersion) {
    console.log(`  ${pkgPath.replace(root, '')} : ${sourceVersion}`);
  } else {
    mismatch = true;
    if (checkOnly) {
      console.error(`  ${pkgPath.replace(root, '')} : ${pkgVersion} (expected ${sourceVersion})`);
    } else {
      pkg.version = sourceVersion;
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`  ${pkgPath.replace(root, '')} : ${pkgVersion} -> ${sourceVersion}`);
    }
  }
}

if (checkOnly && mismatch) {
  console.error('\nVersion mismatch! Run "pnpm version:sync" to fix.');
  process.exit(1);
}
