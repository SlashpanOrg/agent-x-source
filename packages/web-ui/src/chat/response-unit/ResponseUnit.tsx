import { memo, useId, useState, type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  parseResponseDocument,
  type ResponseBlockV1,
  type ResponseDocumentV1,
  type ResponseTone,
} from '@agentx/shared/browser';
import { colors, alphaColor } from '../../theme';
import { ChartBlock } from '../ChartBlock';
import { CrewAwareMarkdown } from '../ChatMarkdown';
import {
  CodeBlockBody,
  CodeBlockChrome,
  CODE_BLOCK_TOKENS,
  formatBlockTitle,
} from '../code-block-chrome';
import { openExternalUrl } from '../../utils/open-external-url';

const toneColor: Record<ResponseTone, string> = {
  neutral: colors.text.tertiary,
  info: colors.accent.blue,
  success: colors.accent.green,
  warning: colors.accent.orange,
  danger: colors.accent.red,
};

function ResponseHeading({ level, text }: {
  level: 2 | 3 | 4;
  text: string;
}) {
  const styles = level === 2
    ? { fontSize: '0.9rem', fontWeight: 700, mt: 0.5, mb: 0.25 }
    : level === 3
      ? { fontSize: '0.78rem', fontWeight: 650, mt: 0.25, mb: 0.1 }
      : { fontSize: '0.7rem', fontWeight: 650, mt: 0.15, mb: 0 };
  return (
    <Typography
      component={`h${level}`}
      sx={{
        ...styles,
        color: colors.text.primary,
        lineHeight: 1.35,
        letterSpacing: '-0.01em',
      }}
    >
      {text}
    </Typography>
  );
}

function CalloutBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'callout' }>;
}) {
  const color = toneColor[block.tone];
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '3px minmax(0, 1fr)',
      gap: 1.1,
      py: 0.8,
      px: 1,
      bgcolor: alphaColor(color, 0.055),
      borderRadius: 1,
    }}>
      <Box sx={{ bgcolor: color, borderRadius: 1 }} />
      <Box sx={{ minWidth: 0 }}>
        {block.title && (
          <Typography sx={{
            color: colors.text.primary,
            fontSize: '0.7rem',
            fontWeight: 650,
            mb: 0.25,
          }}>
            {block.title}
          </Typography>
        )}
        <Typography sx={{
          color: colors.text.secondary,
          fontSize: '0.75rem',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}>
          {block.content}
        </Typography>
      </Box>
    </Box>
  );
}

function StatGridBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'stat_grid' }>;
}) {
  const columns = block.columns ?? Math.min(4, Math.max(2, block.stats.length));
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      gap: 0.75,
      '@container (max-width: 520px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
      '@container (max-width: 280px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
    }}>
      {block.stats.map((stat, index) => {
        const color = stat.tone ? toneColor[stat.tone] : colors.text.primary;
        return (
          <Box
            key={`${stat.label}-${index}`}
            sx={{
              minWidth: 0,
              px: 1,
              py: 0.85,
              bgcolor: alphaColor(colors.bg.elevated, 0.7),
              borderTop: `1px solid ${colors.border.subtle}`,
            }}
          >
            <Typography sx={{
              color,
              fontSize: '1.05rem',
              fontWeight: 700,
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
              overflowWrap: 'anywhere',
            }}>
              {String(stat.value)}
            </Typography>
            <Typography sx={{
              mt: 0.3,
              color: colors.text.tertiary,
              fontSize: '0.59rem',
              lineHeight: 1.35,
            }}>
              {stat.label}
            </Typography>
            {stat.detail && (
              <Typography sx={{
                mt: 0.25,
                color: colors.text.dim,
                fontSize: '0.54rem',
                lineHeight: 1.35,
              }}>
                {stat.detail}
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function ComparisonBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'comparison' }>;
}) {
  return (
    <Box>
      {block.title && (
        <Typography sx={{ mb: 0.65, color: colors.text.primary, fontSize: '0.72rem', fontWeight: 650 }}>
          {block.title}
        </Typography>
      )}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: `repeat(${block.items.length}, minmax(0, 1fr))`,
        gap: 0.8,
        '@container (max-width: 520px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
      }}>
        {block.items.map((item, index) => {
          const color = item.tone ? toneColor[item.tone] : colors.text.tertiary;
          return (
            <Box
              key={`${item.title}-${index}`}
              sx={{
                minWidth: 0,
                border: `1px solid ${colors.border.subtle}`,
                borderRadius: 1,
                overflow: 'hidden',
              }}
            >
              <Box sx={{
                px: 1,
                py: 0.65,
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                borderBottom: `1px solid ${colors.border.subtle}`,
                bgcolor: alphaColor(colors.bg.elevated, 0.6),
              }}>
                <Typography sx={{ flex: 1, color: colors.text.primary, fontSize: '0.68rem', fontWeight: 650 }}>
                  {item.title}
                </Typography>
                {item.badge && (
                  <Typography sx={{
                    color,
                    fontSize: '0.5rem',
                    fontFamily: "'JetBrains Mono', monospace",
                    whiteSpace: 'nowrap',
                  }}>
                    {item.badge}
                  </Typography>
                )}
              </Box>
              <Box sx={{ px: 1, py: 0.8 }}>
                {item.body && (
                  <Typography sx={{
                    color: colors.text.secondary,
                    fontSize: '0.72rem',
                    lineHeight: 1.55,
                    whiteSpace: 'pre-wrap',
                  }}>
                    {item.body}
                  </Typography>
                )}
                {!!item.bullets?.length && (
                  <Box component="ul" sx={{ m: 0, mt: item.body ? 0.65 : 0, pl: 1.8 }}>
                    {item.bullets.map((bullet, bulletIndex) => (
                      <Typography
                        key={`${bulletIndex}-${bullet}`}
                        component="li"
                        sx={{
                          mb: 0.3,
                          color: colors.text.secondary,
                          fontSize: '0.7rem',
                          lineHeight: 1.5,
                          '&::marker': { color },
                        }}
                      >
                        {bullet}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function TableBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'table' }>;
}) {
  const [showAllRows, setShowAllRows] = useState(false);
  const visibleRows = showAllRows ? block.rows : block.rows.slice(0, 100);
  return (
    <Box>
      {block.title && (
        <Typography sx={{ mb: 0.55, color: colors.text.primary, fontSize: '0.72rem', fontWeight: 650 }}>
          {block.title}
        </Typography>
      )}
      <Box
        className="ax-scroll-x"
        sx={{
          overflowX: 'auto',
          border: `1px solid ${colors.border.subtle}`,
          borderRadius: 1,
        }}
      >
        <Box component="table" sx={{
          width: '100%',
          borderCollapse: 'collapse',
          tableLayout: block.headers.length > 6 ? 'auto' : 'fixed',
          '& th': {
            px: 1,
            py: 0.65,
            bgcolor: colors.bg.secondary,
            borderBottom: `1px solid ${colors.border.default}`,
            color: colors.text.primary,
            fontSize: '0.57rem',
            lineHeight: 1.35,
            fontWeight: 650,
            verticalAlign: 'bottom',
            whiteSpace: 'normal',
          },
          '& td': {
            px: 1,
            py: 0.6,
            borderBottom: `1px solid ${colors.border.subtle}`,
            color: colors.text.secondary,
            fontSize: '0.62rem',
            lineHeight: 1.45,
            verticalAlign: 'top',
            overflowWrap: 'anywhere',
          },
          '& tbody tr:last-child td': { borderBottom: 0 },
          ...(block.striped ? {
            '& tbody tr:nth-of-type(even) td': {
              bgcolor: alphaColor(colors.bg.elevated, 0.45),
            },
          } : {}),
        }}>
          {block.caption && (
            <Box component="caption" sx={{
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
            }}>
              {block.caption}
            </Box>
          )}
          <Box component="thead">
            <Box component="tr">
              {block.headers.map((header, index) => (
                <Box
                  key={`${header}-${index}`}
                  component="th"
                  scope="col"
                  sx={{ textAlign: block.align?.[index] ?? 'left' }}
                >
                  {header}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {visibleRows.map((row, rowIndex) => (
              <Box component="tr" key={`row-${rowIndex}`}>
                {block.headers.map((_, cellIndex) => (
                  <Box
                    component="td"
                    key={`cell-${rowIndex}-${cellIndex}`}
                    sx={{
                      textAlign: block.align?.[cellIndex] ?? 'left',
                      fontWeight: cellIndex === 0 ? 550 : 400,
                      color: cellIndex === 0 ? `${colors.text.primary} !important` : undefined,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {row[cellIndex] == null ? '' : String(row[cellIndex])}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      {block.rows.length > 100 && (
        <Box
          component="button"
          type="button"
          onClick={() => setShowAllRows((value) => !value)}
          aria-expanded={showAllRows}
          sx={{
            mt: 0.4,
            p: 0,
            bgcolor: 'transparent',
            border: 0,
            color: colors.accent.blue,
            cursor: 'pointer',
            fontSize: '0.54rem',
            fontFamily: "'JetBrains Mono', monospace",
            '&:focus-visible': { outline: `1px solid ${colors.accent.blue}`, outlineOffset: 2 },
          }}
        >
          {showAllRows ? 'Show first 100 rows' : `Show all ${block.rows.length} rows`}
        </Box>
      )}
      {block.caption && (
        <Typography sx={{ mt: 0.45, color: colors.text.dim, fontSize: '0.52rem', lineHeight: 1.4 }}>
          {block.caption}
        </Typography>
      )}
    </Box>
  );
}

function KeyValueBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'key_value' }>;
}) {
  return (
    <Box>
      {block.title && (
        <Typography sx={{ mb: 0.55, color: colors.text.primary, fontSize: '0.72rem', fontWeight: 650 }}>
          {block.title}
        </Typography>
      )}
      <Box component="dl" sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(100px, 0.38fr) minmax(0, 1fr)',
        '@container (max-width: 360px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
        borderTop: `1px solid ${colors.border.subtle}`,
      }}>
        {block.items.map((item, index) => (
          <Box key={`${item.label}-${index}`} sx={{ display: 'contents' }}>
            <Typography component="dt" sx={{
              m: 0,
              px: 0.9,
              py: 0.55,
              color: colors.text.tertiary,
              fontSize: '0.58rem',
              borderBottom: `1px solid ${colors.border.subtle}`,
            }}>
              {item.label}
            </Typography>
            <Box component="dd" sx={{
              m: 0,
              px: 0.9,
              py: 0.55,
              minWidth: 0,
              borderBottom: `1px solid ${colors.border.subtle}`,
            }}>
              <Typography sx={{
                color: colors.text.primary,
                fontSize: '0.64rem',
                lineHeight: 1.45,
                overflowWrap: 'anywhere',
              }}>
                {String(item.value)}
              </Typography>
              {item.detail && (
                <Typography sx={{ mt: 0.2, color: colors.text.dim, fontSize: '0.52rem', lineHeight: 1.4 }}>
                  {item.detail}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ChecklistBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'checklist' }>;
}) {
  return (
    <Box>
      {block.title && (
        <Typography sx={{ mb: 0.55, color: colors.text.primary, fontSize: '0.72rem', fontWeight: 650 }}>
          {block.title}
        </Typography>
      )}
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.42 }}>
        {block.items.map((item, index) => {
          const done = item.status === 'done';
          const skipped = item.status === 'skipped';
          const active = item.status === 'in_progress';
          const color = done
            ? colors.accent.green
            : active
              ? colors.accent.blue
              : skipped
                ? colors.text.dim
                : colors.border.strong;
          return (
            <Box
              component="li"
              key={`${item.text}-${index}`}
              aria-label={`${item.text}, ${item.status.replace('_', ' ')}`}
              sx={{ display: 'flex', gap: 0.7, alignItems: 'flex-start' }}
            >
              <Box aria-hidden sx={{
                mt: '3px',
                width: 11,
                height: 11,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                borderRadius: '3px',
                border: `1px solid ${color}`,
                bgcolor: done ? alphaColor(color, 0.14) : 'transparent',
                color,
                fontSize: '0.45rem',
                lineHeight: 1,
              }}>
                {done ? '✓' : active ? '•' : ''}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{
                  color: skipped ? colors.text.dim : colors.text.secondary,
                  fontSize: '0.68rem',
                  lineHeight: 1.45,
                  textDecoration: skipped ? 'line-through' : 'none',
                }}>
                  {item.text}
                </Typography>
                {item.detail && (
                  <Typography sx={{ mt: 0.15, color: colors.text.dim, fontSize: '0.52rem', lineHeight: 1.4 }}>
                    {item.detail}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function TimelineBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'timeline' }>;
}) {
  const titleId = useId();
  return (
    <Box>
      {block.title && (
        <Typography id={titleId} sx={{ mb: 0.65, color: colors.text.primary, fontSize: '0.72rem', fontWeight: 650 }}>
          {block.title}
        </Typography>
      )}
      <Box
        component="ol"
        {...(block.title ? { 'aria-labelledby': titleId } : {})}
        sx={{ m: 0, p: 0, listStyle: 'none' }}
      >
        {block.items.map((item, index) => {
          const color = item.tone ? toneColor[item.tone] : colors.accent.blue;
          return (
            <Box
              component="li"
              key={`${item.title}-${index}`}
              sx={{ position: 'relative', display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 0.65, pb: index === block.items.length - 1 ? 0 : 0.85 }}
            >
              <Box aria-hidden sx={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                {index < block.items.length - 1 && (
                  <Box sx={{ position: 'absolute', top: 10, bottom: -7, width: '1px', bgcolor: colors.border.default }} />
                )}
                <Box sx={{ mt: '3px', width: 8, height: 8, zIndex: 1, borderRadius: '50%', bgcolor: color }} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, flexWrap: 'wrap' }}>
                  <Typography sx={{ color: colors.text.primary, fontSize: '0.67rem', fontWeight: 650, lineHeight: 1.4 }}>
                    {item.title}
                  </Typography>
                  {item.time && (
                    <Typography sx={{ color: colors.text.dim, fontSize: '0.5rem', fontFamily: "'JetBrains Mono', monospace" }}>
                      {item.time}
                    </Typography>
                  )}
                </Box>
                {item.description && (
                  <Typography sx={{ mt: 0.18, color: colors.text.tertiary, fontSize: '0.61rem', lineHeight: 1.45 }}>
                    {item.description}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function CodeResponseBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'code' }>;
}) {
  return (
    <CodeBlockChrome title={block.title || formatBlockTitle(block.language)} copyText={block.code}>
      <CodeBlockBody>
        <Box
          component="pre"
          className="ax-scroll-x"
          sx={{
            m: 0,
            overflowX: 'auto',
            color: colors.text.secondary,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: CODE_BLOCK_TOKENS.monoFontSize,
            lineHeight: CODE_BLOCK_TOKENS.monoLineHeight,
            whiteSpace: 'pre',
          }}
        >
          {block.code}
        </Box>
      </CodeBlockBody>
    </CodeBlockChrome>
  );
}

function LinkListBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'link_list' }>;
}) {
  return (
    <Box>
      {block.title && (
        <Typography sx={{ mb: 0.5, color: colors.text.primary, fontSize: '0.72rem', fontWeight: 650 }}>
          {block.title}
        </Typography>
      )}
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.35 }}>
        {block.links.map((link, index) => (
          <Box component="li" key={`${link.href}-${index}`}>
            <Box
              component="a"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${link.label} (opens in external browser)`}
              onClick={(event: MouseEvent) => {
                event.preventDefault();
                event.stopPropagation();
                openExternalUrl(link.href);
              }}
              sx={{
                display: 'block',
                px: 0.8,
                py: 0.55,
                borderRadius: 0.75,
                color: colors.accent.blue,
                textDecoration: 'none',
                border: `1px solid transparent`,
                overflowWrap: 'anywhere',
                '&:hover, &:focus-visible': {
                  bgcolor: alphaColor(colors.accent.blue, 0.05),
                  borderColor: colors.border.subtle,
                  outline: 'none',
                },
              }}
            >
              <Typography component="span" sx={{ color: 'inherit', fontSize: '0.65rem', fontWeight: 600 }}>
                {link.label}
              </Typography>
              {link.description && (
                <Typography sx={{ mt: 0.15, color: colors.text.dim, fontSize: '0.52rem', lineHeight: 1.4 }}>
                  {link.description}
                </Typography>
              )}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function CollapsibleBlock({ block }: {
  block: Extract<ResponseBlockV1, { type: 'collapsible' }>;
}) {
  const [open, setOpen] = useState(block.defaultOpen ?? false);
  const regionId = useId();
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <Box sx={{ borderTop: `1px solid ${colors.border.subtle}`, borderBottom: `1px solid ${colors.border.subtle}` }}>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
        sx={{
          width: '100%',
          m: 0,
          px: 0.35,
          py: 0.65,
          display: 'flex',
          alignItems: 'center',
          gap: 0.65,
          textAlign: 'left',
          bgcolor: 'transparent',
          border: 0,
          color: colors.text.primary,
          cursor: 'pointer',
          '&:focus-visible': { outline: `1px solid ${colors.accent.blue}`, outlineOffset: 2 },
        }}
      >
        <Typography aria-hidden sx={{
          color: colors.text.dim,
          fontSize: '0.62rem',
          transform: open ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.16s ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}>
          ›
        </Typography>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ color: colors.text.primary, fontSize: '0.67rem', fontWeight: 650 }}>
            {block.title}
          </Typography>
          {block.summary && (
            <Typography sx={{ mt: 0.12, color: colors.text.dim, fontSize: '0.52rem', lineHeight: 1.35 }}>
              {block.summary}
            </Typography>
          )}
        </Box>
      </Box>
      <Collapse in={open} timeout={reduceMotion ? 0 : undefined} unmountOnExit>
        <Box id={regionId} sx={{ px: 0.35, pb: 0.8, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {block.blocks.map((child, index) => (
            <ResponseBlock key={child.id || `${child.type}-${index}`} block={child} />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function ResponseBlock({ block }: { block: ResponseBlockV1 }) {
  switch (block.type) {
    case 'text':
      return (
        <Typography sx={{
          color: colors.text.secondary,
          fontSize: '0.76rem',
          lineHeight: 1.62,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}>
          {block.content}
        </Typography>
      );
    case 'heading':
      return <ResponseHeading level={block.level} text={block.text} />;
    case 'divider':
      return <Box role="separator" sx={{ height: '1px', bgcolor: colors.border.subtle, my: 0.15 }} />;
    case 'callout':
      return <CalloutBlock block={block} />;
    case 'stat_grid':
      return <StatGridBlock block={block} />;
    case 'comparison':
      return <ComparisonBlock block={block} />;
    case 'table':
      return <TableBlock block={block} />;
    case 'chart':
      return (
        <Box role="figure" aria-label={block.summary || block.spec.title || 'Data visualization'}>
          <ChartBlock code={JSON.stringify(block.spec)} language="chart" />
          {block.summary && (
            <Typography sx={{ mt: 0.35, color: colors.text.tertiary, fontSize: '0.57rem', lineHeight: 1.45 }}>
              {block.summary}
            </Typography>
          )}
          {block.caption && (
            <Typography sx={{ mt: 0.35, color: colors.text.dim, fontSize: '0.52rem', lineHeight: 1.4 }}>
              {block.caption}
            </Typography>
          )}
        </Box>
      );
    case 'key_value':
      return <KeyValueBlock block={block} />;
    case 'checklist':
      return <ChecklistBlock block={block} />;
    case 'timeline':
      return <TimelineBlock block={block} />;
    case 'code':
      return <CodeResponseBlock block={block} />;
    case 'link_list':
      return <LinkListBlock block={block} />;
    case 'collapsible':
      return <CollapsibleBlock block={block} />;
  }
}

function ResponseUnitComponent({
  document,
  fallbackMarkdown,
}: {
  document: ResponseDocumentV1 | unknown;
  fallbackMarkdown?: string;
}) {
  const titleId = useId();
  const parsed = parseResponseDocument(document);
  if (!parsed.ok) {
    return fallbackMarkdown?.trim()
      ? <CrewAwareMarkdown content={fallbackMarkdown} />
      : null;
  }

  const response = parsed.document;
  const statusColor = response.status ? toneColor[response.status] : colors.text.tertiary;

  return (
    <Box
      component="article"
      data-response-unit
      {...(response.title ? { 'aria-labelledby': titleId } : { 'aria-label': 'Structured response' })}
      sx={{
        width: '100%',
        minWidth: 0,
        containerType: 'inline-size',
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: 1.25,
        bgcolor: alphaColor(colors.bg.secondary, 0.72),
        overflow: 'hidden',
      }}
    >
      {(response.title || response.subtitle) && (
        <Box sx={{
          px: 1.4,
          pt: 1.2,
          pb: 0.95,
          borderBottom: `1px solid ${colors.border.subtle}`,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.8 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              {response.title && (
                <Typography id={titleId} component="h1" sx={{
                  m: 0,
                  color: colors.text.primary,
                  fontSize: '0.96rem',
                  fontWeight: 720,
                  lineHeight: 1.3,
                  letterSpacing: '-0.015em',
                  overflowWrap: 'anywhere',
                }}>
                  {response.title}
                </Typography>
              )}
              {response.subtitle && (
                <Typography sx={{
                  mt: response.title ? 0.35 : 0,
                  color: colors.text.tertiary,
                  fontSize: '0.6rem',
                  lineHeight: 1.45,
                }}>
                  {response.subtitle}
                </Typography>
              )}
            </Box>
            {response.status && (
              <Typography sx={{
                flexShrink: 0,
                px: 0.65,
                py: 0.2,
                borderRadius: 10,
                bgcolor: alphaColor(statusColor, 0.1),
                color: statusColor,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.48rem',
                fontWeight: 650,
                textTransform: 'uppercase',
              }}>
                {response.status}
              </Typography>
            )}
          </Box>
        </Box>
      )}

      <Box sx={{
        px: response.density === 'comfortable' ? 1.5 : 1.25,
        py: response.density === 'comfortable' ? 1.4 : 1.1,
        display: 'flex',
        flexDirection: 'column',
        gap: response.density === 'comfortable' ? 1.25 : 0.9,
      }}>
        {response.blocks.map((block, index) => (
          <ResponseBlock key={block.id || `${block.type}-${index}`} block={block} />
        ))}
        {response.sourceCaption && (
          <Typography sx={{
            pt: 0.25,
            color: colors.text.dim,
            fontSize: '0.5rem',
            lineHeight: 1.4,
          }}>
            {response.sourceCaption}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export const ResponseUnit = memo(ResponseUnitComponent);
