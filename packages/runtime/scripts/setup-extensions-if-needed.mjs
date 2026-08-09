/**
 * Run setup:extensions only when pgvector is not already installed in embedded PostgreSQL.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(__dirname, '..', '..', '..');

if (process.env.AGENTX_SKIP_EXTENSIONS === '1') {
  console.log('Skipping setup:extensions (AGENTX_SKIP_EXTENSIONS=1)');
  process.exit(0);
}

function embeddedPackageName() {
  const plat = platform();
  const cpu = arch();
  if (plat === 'darwin') {
    return cpu === 'arm64' ? '@embedded-postgres/darwin-arm64' : '@embedded-postgres/darwin-x64';
  }
  if (plat === 'linux') {
    return cpu === 'arm64' ? '@embedded-postgres/linux-arm64' : '@embedded-postgres/linux-x64';
  }
  if (plat === 'win32' && cpu === 'x64') return '@embedded-postgres/windows-x64';
  return null;
}

function pgVectorControlPath(nativeDir) {
  if (platform() === 'win32') {
    return join(nativeDir, 'share', 'extension', 'vector.control');
  }
  return join(nativeDir, 'share', 'postgresql', 'extension', 'vector.control');
}

function pgvectorAlreadyInstalled() {
  const pkg = embeddedPackageName();
  if (!pkg) return false;
  const candidates = [
    join(workspaceRoot, 'node_modules', ...pkg.split('/'), 'native'),
    join(workspaceRoot, 'packages', 'runtime', 'node_modules', ...pkg.split('/'), 'native'),
    join(workspaceRoot, 'packages', 'desktop', 'node_modules', ...pkg.split('/'), 'native'),
  ];
  for (const nativeDir of candidates) {
    if (existsSync(pgVectorControlPath(nativeDir))) return true;
  }
  return false;
}

if (pgvectorAlreadyInstalled()) {
  console.log('pgvector already installed in embedded PostgreSQL — skipping setup:extensions');
  process.exit(0);
}

execSync('node scripts/setup-pgvector.mjs', {
  stdio: 'inherit',
  cwd: join(__dirname, '..'),
});
