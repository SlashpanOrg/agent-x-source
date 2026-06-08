import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { execSync } from 'child_process';

const BUILD = join(import.meta.dirname, '..', 'build');
const ICON_PNG = join(BUILD, 'icon.png');
const TRAY_PNG = join(BUILD, 'tray.png');
const ICON_ICNS = join(BUILD, 'icon.icns');
const IS_MAC = platform() === 'darwin';

if (!existsSync(ICON_PNG)) {
  console.error('Source icon.png not found at', ICON_PNG);
  process.exit(1);
}

const tmpDir = mkdtempSync(join(tmpdir(), 'agentx-icons-'));
const sizes = [
  ['icon_16x16.png', 16], ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32], ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128], ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256], ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512], ['icon_512x512@2x.png', 1024],
];

function hasPillow(py) {
  try { execSync(`${py} -c "from PIL import Image"`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

function getPython() {
  for (const py of ['python3', 'python']) {
    try { execSync(`${py} -c "import sys"`, { stdio: 'pipe' }); return py; }
    catch {}
  }
  return null;
}

try {
  const py = getPython();
  if (!py || !hasPillow(py)) {
    console.log('Python/Pillow not available, copying existing icons as-is');
  } else {
    const script = `
import sys
from PIL import Image

src = sys.argv[1]
out_dir = sys.argv[2]
tray_path = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != 'none' else None

img = Image.open(src).convert('RGBA')
w, h = img.size
needs_padding = False

if w == 1024 and h == 1024:
    bbox = img.getbbox()
    if bbox and bbox[0] < 80:
        needs_padding = True

if needs_padding:
    resized = img.resize((824, 824), Image.LANCZOS)
    canvas = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    canvas.paste(resized, (100, 100), resized)
    canvas.save(f'{out_dir}/icon_1024.png')
else:
    img.save(f'{out_dir}/icon_1024.png')

for name, size_s in [('icon_16x16.png',16),('icon_16x16@2x.png',32),('icon_32x32.png',32),('icon_32x32@2x.png',64),('icon_128x128.png',128),('icon_128x128@2x.png',256),('icon_256x256.png',256),('icon_256x256@2x.png',512),('icon_512x512.png',512),('icon_512x512@2x.png',1024)]:
    Image.open(f'{out_dir}/icon_1024.png').resize((size_s, size_s), Image.LANCZOS).save(f'{out_dir}/{name}')

if tray_path:
    t = Image.open(tray_path)
    if t.mode != 'RGBA':
        t = t.convert('RGBA')
    t.resize((32, 32), Image.LANCZOS).save(tray_path)
`;

    const scriptPath = join(tmpDir, 'gen.py');
    writeFileSync(scriptPath, script);
    const trayArg = existsSync(TRAY_PNG) ? TRAY_PNG : 'none';
    execSync(`${py} "${scriptPath}" "${ICON_PNG}" "${tmpDir}" "${trayArg}"`, { stdio: 'pipe' });

    copyFileSync(join(tmpDir, 'icon_1024.png'), ICON_PNG);

    if (IS_MAC) {
      const iconset = join(tmpDir, 'AppIcon.iconset');
      mkdirSync(iconset, { recursive: true });
      for (const [name] of sizes) {
        copyFileSync(join(tmpDir, name), join(iconset, name));
      }
      execSync(`iconutil -c icns "${iconset}" -o "${ICON_ICNS}"`, { stdio: 'pipe' });
      console.log('Icons generated (macOS .icns included)');
    } else {
      console.log('Icons generated');
    }
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
