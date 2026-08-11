import type { ResponseDocumentV1 } from '@agentx/shared/browser';

export const RESPONSE_UNIT_FIXTURES: Record<string, ResponseDocumentV1> = {
  analyticalTradeoff: {
    version: 1,
    revision: 1,
    title: 'Platform gain, loss, and trade-off analysis',
    subtitle: 'Fixture: analytical report',
    status: 'success',
    density: 'compact',
    blocks: [
      {
        type: 'callout',
        tone: 'info',
        title: 'How to read this report',
        content: 'Benefit impact is compared with implementation and maintenance burden.',
      },
      {
        type: 'stat_grid',
        columns: 4,
        stats: [
          { value: '75–85%', label: 'Capability coverage', tone: 'success' },
          { value: '17%', label: 'Average benefit', tone: 'info' },
          { value: '11%', label: 'Trade-off score', tone: 'warning' },
          { value: '13/16', label: 'Favorable modules' },
        ],
      },
      {
        type: 'chart',
        summary: 'Compatibility has the strongest benefit-to-trade-off ratio.',
        spec: {
          v: 1,
          type: 'bar_grouped',
          title: 'Impact by module group',
          xKey: 'group',
          series: ['benefit', 'tradeoff'],
          data: [
            { group: 'Compatibility', benefit: 21, tradeoff: 7 },
            { group: 'Orchestration', benefit: 19, tradeoff: 11 },
            { group: 'Autonomy', benefit: 17, tradeoff: 15 },
          ],
        },
      },
      {
        type: 'table',
        title: 'Detailed module split',
        headers: ['Module', 'Benefit', 'Risk', 'Net'],
        rows: [
          ['Persistence', '24%', '8%', '+19'],
          ['Turn policy', '22%', '13%', '+14'],
          ['A3 actions', '12%', '25%', '-7'],
        ],
        align: ['left', 'right', 'right', 'right'],
        striped: true,
      },
    ],
    sourceCaption: 'Source: deterministic ResponseUnit fixture.',
  },
  sessionForensics: {
    version: 1,
    revision: 1,
    title: 'Session forensics: document analysis failure',
    subtitle: 'Fixture: forensic audit',
    status: 'danger',
    density: 'compact',
    blocks: [
      {
        type: 'callout',
        tone: 'danger',
        title: 'Verdict',
        content: 'The document was not materialized before the reasoning loop and the turn made no useful progress.',
      },
      {
        type: 'stat_grid',
        columns: 4,
        stats: [
          { value: '6.0 min', label: 'Turn duration', tone: 'warning' },
          { value: '100+', label: 'Tool invocations', tone: 'danger' },
          { value: '0', label: 'OCR calls', tone: 'danger' },
          { value: '1/3', label: 'Todos done', tone: 'warning' },
        ],
      },
      {
        type: 'timeline',
        title: 'Observed execution',
        items: [
          { title: 'Ingest', description: 'Attachment yielded unusable text.', tone: 'danger' },
          { title: 'Discovery loop', description: 'Repeated tool search without progress.', tone: 'warning' },
          { title: 'Turn end', description: 'No deliverable was produced.', tone: 'danger' },
        ],
      },
      {
        type: 'collapsible',
        title: 'Root-cause evidence',
        summary: 'Ordered evidence retained behind one keyboard-accessible disclosure.',
        blocks: [
          { type: 'heading', level: 3, text: 'Document understanding was not a first-class stage' },
          { type: 'text', content: 'Raw PDF bytes reached the model instead of a typed DocumentObject.' },
          {
            type: 'checklist',
            title: 'Remediation',
            items: [
              { text: 'Materialize documents before reasoning', status: 'done' },
              { text: 'Fail closed to OCR on low-quality text', status: 'done' },
            ],
          },
        ],
      },
    ],
  },
  hardwareComparison: {
    version: 1,
    revision: 1,
    title: 'Runtime Governor — two-machine comparison',
    subtitle: 'Fixture: responsive hardware comparison',
    status: 'info',
    density: 'comfortable',
    blocks: [
      {
        type: 'comparison',
        items: [
          {
            title: 'MacBook Air M2 · 8GB',
            badge: 'Current',
            bullets: ['8 logical cores', 'Memory-bound', 'Balanced 30–40%'],
            tone: 'warning',
          },
          {
            title: 'MacBook Pro M5 Max · 64GB',
            badge: 'Planned',
            bullets: ['18 logical cores', 'Concurrency headroom', 'Performance 70% for bursts'],
            tone: 'success',
          },
        ],
      },
      {
        type: 'key_value',
        title: 'Balanced 40% lane comparison',
        items: [
          { label: 'LLM/tool lanes', value: '3 vs 7' },
          { label: 'Background CPU', value: '2 vs 4' },
          { label: 'Attachment workers', value: '1 vs 2' },
        ],
      },
      {
        type: 'table',
        title: 'Recommended presets',
        headers: ['Machine', 'Daily profile', 'Burst profile'],
        rows: [
          ['Air', '30–40%', 'Short 70% only'],
          ['Pro', '40%', '70% crew/research'],
        ],
      },
      {
        type: 'code',
        title: 'Governor formula',
        language: 'text',
        code: 'effective = round(logicalCores × budgetPercent / 100)',
      },
    ],
  },
};
