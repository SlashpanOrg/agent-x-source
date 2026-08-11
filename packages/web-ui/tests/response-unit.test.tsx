import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResponseUnit } from '../src/chat/response-unit/ResponseUnit';
import { RESPONSE_UNIT_FIXTURES } from '../src/chat/response-unit/response-unit-fixtures';

describe('ResponseUnit', () => {
  it('renders all screenshot-family fixtures without live model output', () => {
    for (const [name, document] of Object.entries(RESPONSE_UNIT_FIXTURES)) {
      const html = renderToStaticMarkup(<ResponseUnit document={document} />);
      expect(html, name).toContain('data-response-unit');
      expect(html, name).toContain(document.title);
    }
  });

  it('renders trusted analytical blocks as one response surface', () => {
    const html = renderToStaticMarkup(
      <ResponseUnit
        document={{
          version: 1,
          title: 'Upgrade analysis',
          status: 'success',
          density: 'compact',
          blocks: [
            {
              type: 'callout',
              tone: 'info',
              title: 'Verdict',
              content: 'Proceed behind a feature flag.',
            },
            {
              type: 'stat_grid',
              columns: 2,
              stats: [
                { value: '24%', label: 'Benefit impact', tone: 'success' },
                { value: '8%', label: 'Regression risk', tone: 'warning' },
              ],
            },
            {
              type: 'table',
              headers: ['Module', 'Impact'],
              rows: [['Renderer', 'High']],
            },
            {
              type: 'key_value',
              items: [{ label: 'Owner', value: 'Agent-X' }],
            },
            {
              type: 'checklist',
              items: [{ text: 'Validate restore', status: 'done' }],
            },
            {
              type: 'timeline',
              items: [{ title: 'Foundation', time: 'Phase 1', description: 'Ship the renderer.' }],
            },
            {
              type: 'code',
              language: 'ts',
              code: 'const safe = true;',
            },
            {
              type: 'link_list',
              links: [{ label: 'Documentation', href: 'https://example.com/docs' }],
            },
            {
              type: 'collapsible',
              title: 'Evidence',
              defaultOpen: true,
              blocks: [{ type: 'text', content: 'Verified evidence.' }],
            },
          ],
        }}
      />,
    );

    expect(html).toContain('data-response-unit');
    expect(html).toContain('Upgrade analysis');
    expect(html).toContain('Proceed behind a feature flag.');
    expect(html).toContain('Benefit impact');
    expect(html).toContain('<table');
    expect(html).toContain('Owner');
    expect(html).toContain('Validate restore');
    expect(html).toContain('Foundation');
    expect(html).toContain('const safe = true;');
    expect(html).toContain('https://example.com/docs');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Verified evidence.');
  });

  it('uses Markdown fallback for an invalid document', () => {
    const html = renderToStaticMarkup(
      <ResponseUnit
        document={{ version: 1, blocks: [{ type: 'iframe' }] }}
        fallbackMarkdown="Fallback answer"
      />,
    );
    expect(html).not.toContain('data-response-unit');
    expect(html).toContain('Fallback answer');
  });

  it('renders model text as escaped content rather than executable HTML', () => {
    const html = renderToStaticMarkup(
      <ResponseUnit
        document={{
          version: 1,
          blocks: [{ type: 'text', content: '<script>alert("unsafe")</script>' }],
        }}
      />,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
