/**
 * Fast path: sync built web-api / web-ui into an unpacked Agent-X.app (no electron-builder).
 * Desktop main/preload live in app.asar — use ./clean-install.sh --repack to update those.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(scriptDir, '..');
const rootDir = join(desktopDir, '..', '..');

function log(message) {
  console.log(`patch-unpacked-app: ${message}`);
}

function rsyncDelete(src, dest) {
  execSync(`rsync -a --delete "${src}/" "${dest}/"`, { stdio: 'inherit' });
}

function main() {
  const appPath = process.argv[2] ?? join(desktopDir, 'release', 'mac-arm64', 'Agent-X.app');
  const appRes = join(appPath, 'Contents', 'Resources');
  if (!existsSync(appRes)) {
    console.error(`patch-unpacked-app: Resources not found at ${appRes}`);
    process.exit(1);
  }

  if (!existsSync(join(appRes, 'app.asar'))) {
    console.error('patch-unpacked-app: app.asar is missing — run ./clean-install.sh --repack');
    process.exit(1);
  }

  const webApiDist = join(rootDir, 'packages', 'web-api', 'dist');
  const webUiDist = join(rootDir, 'packages', 'web-ui', 'dist');

  if (!existsSync(webApiDist) || !existsSync(webUiDist)) {
    console.error('patch-unpacked-app: build web-api and web-ui first');
    process.exit(1);
  }

  log(`syncing web-api → ${join(appRes, 'web-api')}`);
  rsyncDelete(webApiDist, join(appRes, 'web-api'));
  log(`syncing web-ui → ${join(appRes, 'web-ui')}`);
  rsyncDelete(webUiDist, join(appRes, 'web-ui'));

  log('done (web-api + web-ui only; use --repack for desktop main/preload changes)');
}

main();
