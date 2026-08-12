import { describe, expect, it } from 'vitest';
import { getNgrokDownloadSpec } from '../src/host/providers/ngrok-binary.js';

describe('getNgrokDownloadSpec', () => {
  it('maps darwin arm64 to official zip', () => {
    const spec = getNgrokDownloadSpec('darwin', 'arm64');
    expect(spec?.archiveKind).toBe('zip');
    expect(spec?.binaryName).toBe('ngrok');
    expect(spec?.url).toContain('ngrok-v3-stable-darwin-arm64.zip');
    expect(spec?.url.startsWith('https://bin.equinox.io/')).toBe(true);
  });

  it('maps linux x64 to official tgz', () => {
    const spec = getNgrokDownloadSpec('linux', 'x64');
    expect(spec?.archiveKind).toBe('tgz');
    expect(spec?.url).toContain('ngrok-v3-stable-linux-amd64.tgz');
  });

  it('maps windows x64 to official zip exe', () => {
    const spec = getNgrokDownloadSpec('win32', 'x64');
    expect(spec?.archiveKind).toBe('zip');
    expect(spec?.binaryName).toBe('ngrok.exe');
    expect(spec?.url).toContain('ngrok-v3-stable-windows-amd64.zip');
  });

  it('returns null for unsupported platforms', () => {
    expect(getNgrokDownloadSpec('freebsd' as NodeJS.Platform, 'x64')).toBeNull();
  });
});
