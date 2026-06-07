#!/usr/bin/env python3
"""Generate macOS .icns from agent_x_logo.png with a black background."""
import subprocess, os, shutil

SRC = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'release', 'assets', 'agent_x_logo.png')
DEST = os.path.join(os.path.dirname(__file__), '..', 'build', 'icon.icns')

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

BG = (0x0d, 0x11, 0x17, 255)  # #0d1117
ICONSET = '/tmp/agentx.iconset'
if os.path.exists(ICONSET):
    shutil.rmtree(ICONSET)
os.makedirs(ICONSET)

pairs = [(16, 32), (32, 64), (128, 256), (256, 512), (512, 1024)]

if HAS_PILLOW:
    img = Image.open(SRC).convert('RGBA')
    for base, at2x in pairs:
        for size, fname in [(base, f'icon_{base}x{base}.png'), (at2x, f'icon_{base}x{base}@2x.png')]:
            bg = Image.new('RGBA', (size, size), BG)
            # Paste the logo centered at its natural aspect ratio, no scaling distortion
            logo = img.copy()
            logo.thumbnail((size, size), Image.LANCZOS)
            ox, oy = (size - logo.width) // 2, (size - logo.height) // 2
            bg.paste(logo, (ox, oy), logo)
            bg.save(os.path.join(ICONSET, fname))
else:
    for base, at2x in pairs:
        subprocess.run(['sips', '-z', str(base), str(base), SRC, '--out', os.path.join(ICONSET, f'icon_{base}x{base}.png')], check=True, capture_output=True)
        subprocess.run(['sips', '-z', str(at2x), str(at2x), SRC, '--out', os.path.join(ICONSET, f'icon_{base}x{base}@2x.png')], check=True, capture_output=True)

subprocess.run(['iconutil', '-c', 'icns', ICONSET, '-o', DEST], check=True)
shutil.rmtree(ICONSET)
print(f'Created {DEST}')
