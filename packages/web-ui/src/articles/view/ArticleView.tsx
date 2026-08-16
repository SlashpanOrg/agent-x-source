import { Fragment, memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChartBlock } from '../../chat/ChartBlock';
import {
  prepareAssistantMarkup,
  splitColoredMarkup,
} from '../../chat/assistant-markup';
import { CHART_FENCE_LANGS, isChartSpecContent, isMermaidSource } from '@agentx/shared/browser';
import { colors, alphaColor, MONO } from '../../theme';
import type { ArticleKind } from '@agentx/shared/browser';
import type { ArticleBlock, ArticleListItem, CompiledArticle } from '../types';
import { articleKindAccent } from '../kind-theme';

const COLORED_VALUE_SX = {
  fontWeight: 700,
  fontFamily: MONO,
  fontSize: '0.95em',
  whiteSpace: 'nowrap',
} as const;

export function ColoredText({ text }: { text: string }) {
  const prepared = prepareAssistantMarkup(text);
  const segments = splitColoredMarkup(prepared);
  if (segments.length === 1 && segments[0]?.kind === 'text') {
    return <>{segments[0]?.text ?? text}</>;
  }
  return (
    <>
      {segments.map((seg, index) => (
        seg.kind === 'text'
          ? <Fragment key={index}>{seg.text}</Fragment>
          : (
            <Box key={index} component="span" sx={{ ...COLORED_VALUE_SX, color: seg.color }}>
              {seg.text}
            </Box>
          )
      ))}
    </>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  if (/⟦axc:|<|&lt;/.test(text)) {
    return <ColoredText text={text} />;
  }
  return (
    <Box
      component="span"
      sx={{
        '& p': { m: 0, display: 'inline' },
        '& a': { color: colors.accent.cyan },
        '& strong': { color: colors.text.primary, fontWeight: 650 },
        '& code': { fontFamily: MONO, fontSize: '0.9em', color: colors.accent.cyan },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        p: ({ children }) => <>{children}</>,
        a: ({ href, children }) => (
          <Box component="a" href={href} sx={{ color: colors.accent.cyan }}>{children}</Box>
        ),
      }}
      >
        {text}
      </ReactMarkdown>
    </Box>
  );
}

function TableBlock({ block }: { block: Extract<ArticleBlock, { type: 'table' }> }) {
  return (
    <Box
      sx={{
        overflowX: 'auto',
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 1.5,
        bgcolor: alphaColor(colors.bg.elevated, 0.55),
      }}
    >
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: block.headers.length > 6 ? 'auto' : 'fixed',
          '& th': {
            px: 1.15,
            py: 0.85,
            bgcolor: colors.bg.secondary,
            borderBottom: `1px solid ${colors.border.default}`,
            color: colors.text.primary,
            fontSize: '0.58rem',
            lineHeight: 1.35,
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontFamily: MONO,
            verticalAlign: 'bottom',
          },
          '& td': {
            px: 1.15,
            py: 0.75,
            borderBottom: `1px solid ${colors.border.subtle}`,
            color: colors.text.secondary,
            fontSize: '0.72rem',
            lineHeight: 1.5,
            verticalAlign: 'top',
            overflowWrap: 'anywhere',
          },
          '& tbody tr:nth-of-type(even) td': {
            bgcolor: alphaColor(colors.bg.elevated, 0.35),
          },
          '& tbody tr:last-child td': { borderBottom: 0 },
          '& tbody tr:hover td': {
            bgcolor: alphaColor(colors.accent.blue, '08'),
          },
        }}
      >
        <Box component="thead">
          <Box component="tr">
            {block.headers.map((header, index) => (
              <Box
                key={`${header}-${index}`}
                component="th"
                scope="col"
                sx={{ textAlign: block.align[index] ?? 'left' }}
              >
                <ColoredText text={header} />
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {block.rows.map((row, rowIndex) => (
            <Box component="tr" key={`row-${rowIndex}`}>
              {block.headers.map((_, cellIndex) => (
                <Box
                  component="td"
                  key={`cell-${rowIndex}-${cellIndex}`}
                  sx={{
                    textAlign: block.align[cellIndex] ?? 'left',
                    fontWeight: cellIndex === 0 ? 600 : 400,
                    color: cellIndex === 0 ? `${colors.text.primary} !important` : undefined,
                    fontVariantNumeric: 'tabular-nums',
                    fontFamily: cellIndex === 0 ? undefined : MONO,
                    fontSize: cellIndex === 0 ? '0.74rem' : '0.68rem',
                  }}
                >
                  <ColoredText text={row[cellIndex] == null ? '' : String(row[cellIndex])} />
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

function ListBlock({ block }: { block: Extract<ArticleBlock, { type: 'list' }> }) {
  const Component = block.ordered ? 'ol' : 'ul';
  return (
    <Box
      component={Component}
      sx={{
        m: 0,
        pl: 2.2,
        '& li': {
          mb: 0.45,
          color: colors.text.secondary,
          fontSize: '0.8rem',
          lineHeight: 1.55,
        },
        '& li::marker': { color: colors.accent.cyan },
      }}
    >
      {block.items.map((item: ArticleListItem, index) => (
        <Box component="li" key={`item-${index}`}>
          {item.checked != null && (
            <Box component="span" sx={{ mr: 0.6, color: item.checked ? colors.accent.green : colors.text.dim }}>
              {item.checked ? '☑' : '☐'}
            </Box>
          )}
          <InlineMarkdown text={item.text} />
        </Box>
      ))}
    </Box>
  );
}

function ArticleBlockView({ block }: { block: ArticleBlock }) {
  switch (block.type) {
    case 'heading':
      return (
        <Typography
          component={block.level <= 2 ? 'h2' : 'h3'}
          sx={{
            m: 0,
            color: colors.text.primary,
            fontSize: block.level <= 2 ? '0.78rem' : '0.72rem',
            fontWeight: 700,
            letterSpacing: block.level <= 2 ? '0.06em' : '-0.01em',
            textTransform: block.level <= 2 ? 'uppercase' : 'none',
            pb: block.level <= 2 ? 0.7 : 0,
            borderBottom: block.level <= 2 ? `1px solid ${colors.border.subtle}` : 'none',
          }}
        >
          <ColoredText text={block.text} />
        </Typography>
      );
    case 'paragraph':
      return (
        <Typography sx={{
          m: 0,
          color: colors.text.secondary,
          fontSize: '0.84rem',
          lineHeight: 1.65,
        }}
        >
          <InlineMarkdown text={block.text} />
        </Typography>
      );
    case 'table':
      return <TableBlock block={block} />;
    case 'list':
      return <ListBlock block={block} />;
    case 'quote':
      return (
        <Box sx={{
          px: 1.4,
          py: 1,
          borderLeft: `3px solid ${colors.accent.blue}`,
          bgcolor: alphaColor(colors.accent.blue, '0a'),
          borderRadius: '0 10px 10px 0',
          color: colors.text.secondary,
          fontSize: '0.8rem',
          lineHeight: 1.55,
        }}
        >
          <InlineMarkdown text={block.text} />
        </Box>
      );
    case 'code': {
      const lang = block.language;
      if (CHART_FENCE_LANGS.has(lang) || isChartSpecContent(block.code) || isMermaidSource(block.code)) {
        return <ChartBlock code={block.code} language={lang} />;
      }
      return (
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1.25,
            overflowX: 'auto',
            bgcolor: colors.bg.tertiary,
            border: `1px solid ${colors.border.subtle}`,
            borderRadius: 1.25,
            color: colors.text.secondary,
            fontFamily: MONO,
            fontSize: '0.68rem',
            lineHeight: 1.5,
          }}
        >
          {block.code}
        </Box>
      );
    }
    case 'hr':
      return <Box role="separator" sx={{ height: '1px', bgcolor: colors.border.subtle }} />;
  }
}

export const ArticleView = memo(function ArticleView({
  article,
  createdAt,
  sessionId,
  kind = 'article',
}: {
  article: CompiledArticle;
  createdAt?: string;
  sessionId?: string | null;
  kind?: ArticleKind;
}) {
  const accent = articleKindAccent(kind);
  const meta = [
    createdAt ? new Date(createdAt).toLocaleString() : null,
    sessionId ? `session ${sessionId.slice(-8)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Box
      component="article"
      sx={{
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        border: `1px solid ${alphaColor(accent, '28')}`,
        borderRadius: 2,
        bgcolor: alphaColor(colors.bg.secondary, 0.92),
        overflow: 'hidden',
        boxShadow: `0 18px 40px rgba(0,0,0,0.18), 0 0 0 1px ${alphaColor(accent, '10')}`,
      }}
    >
      <Box sx={{
        px: { xs: 1.6, md: 2.2 },
        pt: 1.8,
        pb: 1.4,
        background: `linear-gradient(135deg, ${alphaColor(accent, '18')} 0%, ${alphaColor(colors.bg.tertiary, 0.4)} 55%, transparent 100%)`,
        borderBottom: `1px solid ${alphaColor(accent, '22')}`,
      }}
      >
        <Typography sx={{
          mb: 0.55,
          color: accent,
          fontFamily: MONO,
          fontSize: '0.52rem',
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
        >
          {article.kicker}
        </Typography>
        <Typography component="h1" sx={{
          m: 0,
          color: colors.text.primary,
          fontSize: { xs: '1.05rem', md: '1.22rem' },
          fontWeight: 720,
          letterSpacing: '-0.03em',
          lineHeight: 1.25,
          overflowWrap: 'anywhere',
        }}
        >
          {article.title}
        </Typography>
        {meta && (
          <Typography sx={{
            mt: 0.7,
            color: colors.text.dim,
            fontFamily: MONO,
            fontSize: '0.58rem',
          }}
          >
            {meta}
          </Typography>
        )}
      </Box>

      <Box sx={{
        px: { xs: 1.5, md: 2.1 },
        py: { xs: 1.4, md: 1.8 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.35,
      }}
      >
        {article.blocks.map((block, index) => (
          <ArticleBlockView key={`${block.type}-${index}`} block={block} />
        ))}
      </Box>
    </Box>
  );
});
