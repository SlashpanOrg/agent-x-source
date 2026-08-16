import { describe, expect, it } from 'vitest';
import {
  detectOcrInstaller,
  errorNeedsOcrTools,
  extraOcrPathDirs,
  getOcrToolStatus,
  type OcrToolProbe,
} from '../src/knowledge-base/ocr-tools.js';

function withCommands(platform: OcrToolProbe['platform'], commands: string[], extra: Partial<OcrToolProbe> = {}): OcrToolProbe {
  return {
    platform,
    commandExists: (cmd) => commands.includes(cmd),
    pathExists: extra.pathExists ?? (() => false),
    envPath: extra.envPath ?? '',
    home: extra.home ?? '/home/user',
    localAppData: extra.localAppData,
    canPasswordlessSudo: extra.canPasswordlessSudo,
  };
}

describe('OCR tool install plan', () => {
  it('picks brew on macOS and allows install without elevation', () => {
    const status = getOcrToolStatus(withCommands('darwin', ['brew']));
    expect(status.installed).toBe(false);
    expect(status.missing).toEqual(['tesseract', 'pdftoppm']);
    expect(status.installer).toBe('brew');
    expect(status.canInstall).toBe(true);
    expect(status.elevation).toBe(false);
    expect(status.command).toBe('brew install tesseract poppler');
  });

  it('prefers scoop on Windows, then choco, then winget', () => {
    expect(detectOcrInstaller(withCommands('win32', ['scoop', 'choco', 'winget']))).toBe('scoop');
    expect(detectOcrInstaller(withCommands('win32', ['choco', 'winget']))).toBe('choco');
    expect(detectOcrInstaller(withCommands('win32', ['winget']))).toBe('winget');
  });

  it('uses apt on Linux and blocks install without passwordless sudo', () => {
    const blocked = getOcrToolStatus(withCommands('linux', ['apt-get'], {
      pathExists: (p) => p === '/usr/bin/apt-get',
      canPasswordlessSudo: false,
    }));
    expect(blocked.installer).toBe('apt');
    expect(blocked.canInstall).toBe(false);
    expect(blocked.elevation).toBe(true);
    expect(blocked.command).toMatch(/tesseract-ocr/);

    const allowed = getOcrToolStatus(withCommands('linux', ['apt-get'], {
      pathExists: (p) => p === '/usr/bin/apt-get',
      canPasswordlessSudo: true,
    }));
    expect(allowed.canInstall).toBe(true);
  });

  it('reports installed when both binaries exist', () => {
    const status = getOcrToolStatus(withCommands('darwin', ['tesseract', 'pdftoppm', 'brew']));
    expect(status.installed).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it('exposes platform-specific PATH dirs', () => {
    expect(extraOcrPathDirs(withCommands('darwin', [])).join(' ')).toMatch(/homebrew/);
    expect(extraOcrPathDirs(withCommands('win32', [])).some((d) => d.includes('Tesseract-OCR'))).toBe(true);
  });
});

describe('errorNeedsOcrTools', () => {
  it('matches scanned-PDF and missing-tool faults', () => {
    expect(errorNeedsOcrTools('Scanned PDF — 9 page(s), minimal extractable text')).toBe(true);
    expect(errorNeedsOcrTools('Scanned PDF — OCR tools missing (tesseract not found)')).toBe(true);
    expect(errorNeedsOcrTools('Attachment file not found')).toBe(false);
  });
});
