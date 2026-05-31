import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const xtermDir = join(root, 'node_modules', 'xterm');
const fitDir = join(root, 'node_modules', 'xterm-addon-fit');
const linksDir = join(root, 'node_modules', 'xterm-addon-web-links');
const outDir = join(root, 'renderer', 'xterm');

const files = [
  [join(xtermDir, 'css', 'xterm.css'), join(outDir, 'xterm.css')],
  [join(xtermDir, 'lib', 'xterm.js'), join(outDir, 'xterm.js')],
  [join(fitDir, 'lib', 'xterm-addon-fit.js'), join(outDir, 'xterm-addon-fit.js')],
  [join(linksDir, 'lib', 'xterm-addon-web-links.js'), join(outDir, 'xterm-addon-web-links.js')],
];

mkdirSync(outDir, { recursive: true });

for (const [src, dest] of files) {
  if (!existsSync(src)) {
    console.warn(`Warning: ${src} not found`);
    continue;
  }
  copyFileSync(src, dest);
  console.log(`Copied: ${dest}`);
}

console.log('xterm assets copied to renderer/xterm/');
