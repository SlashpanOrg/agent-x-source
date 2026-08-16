import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extractFromPath: vi.fn(),
  ocrPdfViaShell: vi.fn(),
  cleanupPdfOcrTemp: vi.fn(),
}));

vi.mock('../src/attachments/extract.js', () => ({
  extractFromPath: mocks.extractFromPath,
}));

vi.mock('../src/templates/pdf-ocr.js', () => ({
  ocrPdfViaShell: mocks.ocrPdfViaShell,
  cleanupPdfOcrTemp: mocks.cleanupPdfOcrTemp,
}));

import {
  extractKnowledgeSource,
  isScannedPdfExtractError,
  parseOcrPageText,
} from '../src/knowledge-base/ingest-extract.js';

const USABLE_OCR = [
  '--- Page 1 ---',
  'KIMSHEALTH Department of CLINICAL NUTRITION',
  '',
  '--- Page 2 ---',
  'LOW FAT LOW CHOLESTEROL DIETARY GUIDELINES',
  'The diet is planned to reduce total dietary fat to about 30% of total energy.',
  'When planned to include recommended servings from the Five Food Groups, this diet can be nutritionally adequate.',
  'Foods to Choose include wholegrain bread, cereal, rice, pasta, and fresh vegetables.',
  'Foods to Avoid include fried rice, pastries, and fatty meat.',
].join('\n');

describe('parseOcrPageText', () => {
  it('splits marked pages and keeps holes', () => {
    const pages = parseOcrPageText('--- Page 1 ---\nAlpha\n\n--- Page 3 ---\nGamma');
    expect(pages).toEqual(['Alpha', '', 'Gamma']);
  });

  it('treats unmarked text as a single page', () => {
    expect(parseOcrPageText('just a paragraph')).toEqual(['just a paragraph']);
  });
});

describe('isScannedPdfExtractError', () => {
  it('matches the extract.ts scanned-PDF messages', () => {
    expect(isScannedPdfExtractError(
      'Scanned PDF — 9 page(s), minimal extractable text (likely just metadata/signature, 39 chars/page avg)',
    )).toBe(true);
    expect(isScannedPdfExtractError('Scanned PDF — 3 page(s), no extractable text (image-based/scanned)')).toBe(true);
    expect(isScannedPdfExtractError('Preview not available for image/png')).toBe(false);
  });
});

describe('extractKnowledgeSource', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns native text without OCR', async () => {
    mocks.extractFromPath.mockResolvedValue({ kind: 'text', content: 'hello', pages: ['hello'] });
    const preview = await extractKnowledgeSource('/tmp/a.pdf', 'application/pdf');
    expect(preview.kind).toBe('text');
    expect(preview.content).toBe('hello');
    expect(mocks.ocrPdfViaShell).not.toHaveBeenCalled();
  });

  it('does not OCR non-PDF extract errors', async () => {
    mocks.extractFromPath.mockResolvedValue({ kind: 'error', content: 'Preview not available for image/png' });
    const preview = await extractKnowledgeSource('/tmp/a.png', 'image/png');
    expect(preview.kind).toBe('error');
    expect(mocks.ocrPdfViaShell).not.toHaveBeenCalled();
  });

  it('OCRs a scanned PDF and returns page text', async () => {
    mocks.extractFromPath.mockResolvedValue({
      kind: 'error',
      content: 'Scanned PDF — 9 page(s), minimal extractable text (likely just metadata/signature, 39 chars/page avg)',
    });
    mocks.ocrPdfViaShell.mockResolvedValue({
      text: USABLE_OCR,
      imagePaths: ['/tmp/p1.png', '/tmp/p2.png'],
      numPages: 2,
      method: 'shell',
      tempDir: '/tmp/ocr',
      warnings: [],
    });

    const preview = await extractKnowledgeSource('/tmp/diet.pdf', 'application/pdf');
    expect(preview.kind).toBe('text');
    expect(preview.pages).toHaveLength(2);
    expect(preview.pages?.[1]).toMatch(/LOW FAT LOW CHOLESTEROL/);
    expect(mocks.cleanupPdfOcrTemp).toHaveBeenCalled();
  });

  it('fails clearly when OCR tools are missing', async () => {
    mocks.extractFromPath.mockResolvedValue({
      kind: 'error',
      content: 'Scanned PDF — 9 page(s), no extractable text (image-based/scanned)',
    });
    mocks.ocrPdfViaShell.mockResolvedValue({
      text: '',
      imagePaths: [],
      numPages: 0,
      method: 'shell',
      tempDir: null,
      warnings: ['tesseract not found'],
    });

    const preview = await extractKnowledgeSource('/tmp/diet.pdf', 'application/pdf');
    expect(preview.kind).toBe('error');
    expect(preview.content).toMatch(/OCR tools missing/);
  });
});
