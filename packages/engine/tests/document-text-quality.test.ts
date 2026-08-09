import { describe, expect, it } from 'vitest';
import {
  assessExtractedText,
  isUsableExtractedText,
  looksLikeFailedPdfExtract,
} from '../src/documents/text-quality.js';
import { getCoreTools } from '../src/tools/ProgressiveDisclosure.js';
import type { ToolDefinition } from '@agentx/shared';

describe('document text quality', () => {
  it('rejects empty and binary-heavy extracts', () => {
    expect(isUsableExtractedText('')).toBe(false);
    const binary = 'ABT\u0001\u0002\u0003' + '\u00ff'.repeat(80) + '\u0000'.repeat(40) + 'x'.repeat(10);
    expect(isUsableExtractedText(binary)).toBe(false);
    expect(assessExtractedText('').reason).toBe('empty');
  });

  it('rejects signature-only tender metadata', () => {
    const sig = [
      'Signature Not Verified',
      'Digitally signed by C VIJAYALAKSHMI',
      'Date: 2026.07.29 15:13:39 IST',
      'Location: Tamil Nadu-TN',
    ].join('\n');
    const a = assessExtractedText(sig, { pageCount: 3 });
    expect(a.usable).toBe(false);
  });

  it('rejects CID-like wrong-script garbage', () => {
    // High unicode "letters" with almost no Latin / spaces — classic broken ToUnicode.
    const garbage = Array.from({ length: 200 }, (_, i) => String.fromCodePoint(0x4e00 + (i % 100))).join('');
    const a = assessExtractedText(garbage);
    expect(a.usable).toBe(false);
  });

  it('accepts real English tender prose', () => {
    const text = `
BHARATHIAR UNIVERSITY
COIMBATORE - 641 046, TAMILNADU, INDIA
e-TENDER INVITING NOTICE
Online bids are invited through portal https://tntenders.gov.in for the Purchase of
80 Nos. of Google Workspace License to the Centre for Internet & Website Services as
per the Schedule. The bidders must be registered with Tamil Nadu Government
e-procurement system portal and should possess Digital Signature Certificate.
`;
    const a = assessExtractedText(text, { pageCount: 3 });
    expect(a.usable).toBe(true);
    expect(a.score).toBeGreaterThanOrEqual(45);
  });

  it('flags failed pdf tool outputs', () => {
    expect(looksLikeFailedPdfExtract('ABTÿÿÿ garbage')).toBe(true);
    expect(looksLikeFailedPdfExtract('(PDF contains no usable extractable text and OCR pipeline did not produce output)')).toBe(true);
    expect(looksLikeFailedPdfExtract('Online bids are invited through portal for the Purchase of Google Workspace License')).toBe(false);
  });
});

describe('progressive disclosure document tools', () => {
  it('keeps pdf_read and image_ocr in the core toolset', () => {
    const tools: ToolDefinition[] = [
      {
        id: 'pdf_read',
        name: 'Read PDF',
        description: 'Read PDF',
        modelDescription: 'Read PDF',
        category: 'documents',
        riskLevel: 'low',
        schema: { type: 'object', properties: {}, required: [] },
        composable: true,
        source: 'builtin',
      },
      {
        id: 'image_ocr',
        name: 'Image OCR',
        description: 'OCR',
        modelDescription: 'OCR',
        category: 'media_image',
        riskLevel: 'low',
        schema: { type: 'object', properties: {}, required: [] },
        composable: true,
        source: 'builtin',
      },
      {
        id: 'obscure_tool_xyz',
        name: 'Obscure',
        description: 'hidden',
        modelDescription: 'hidden',
        category: 'ai_meta',
        riskLevel: 'low',
        schema: { type: 'object', properties: {}, required: [] },
        composable: false,
        source: 'builtin',
      },
    ];
    const core = getCoreTools(tools);
    expect(core.map((t) => t.id).sort()).toEqual(['image_ocr', 'pdf_read']);
  });
});
