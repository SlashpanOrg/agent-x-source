import { describe, expect, it } from 'vitest';
import { errorNeedsOcrInstall } from '../src/components/OcrStackInstallButton';

describe('errorNeedsOcrInstall', () => {
  it('shows the install button for scanned-PDF and missing-tool faults', () => {
    expect(errorNeedsOcrInstall('Scanned PDF — 9 page(s), minimal extractable text')).toBe(true);
    expect(errorNeedsOcrInstall('Scanned PDF — OCR tools missing (tesseract not found)')).toBe(true);
    expect(errorNeedsOcrInstall('Attachment file not found')).toBe(false);
  });
});
