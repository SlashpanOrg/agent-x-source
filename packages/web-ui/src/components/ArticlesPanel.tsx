import { useState, useEffect, useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { PanelHeader } from './PanelHeader';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { ArticleViewer } from './ArticleViewer';
import { articles, type ArticleRecord } from '../api';
import { groupArticlesByDay } from '../articles/list-groups';
import { articleKindLabel, displayArticleTitle, humanizeArticleExcerpt, type ArticleKind } from '@agentx/shared/browser';
import { useApp } from '../store/AppContext';
import { colors, MONO, PANEL_SIDE_LIST_WIDTH, alphaColor } from '../theme';
import { articleKindAccent } from '../articles/kind-theme';
import { AGENTX_CLIENT_STORAGE_PREFIX } from '../utils/client-storage';

const LIST_COLLAPSED_KEY = `${AGENTX_CLIENT_STORAGE_PREFIX}articles_list_collapsed`;

function readListCollapsed(): boolean {
  try {
    return localStorage.getItem(LIST_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeListCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(LIST_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    /* private mode / quota */
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function DateGroupDivider({ label, first }: { label: string; first?: boolean }) {
  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 0.6,
      mt: first ? 0.25 : 1.1,
      mb: 0.55,
      px: 0.15,
    }}>
      <Box sx={{ flex: 1, height: '1px', bgcolor: colors.border.subtle }} />
      <Typography sx={{
        fontSize: '0.48rem',
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        color: colors.text.dim,
        fontFamily: MONO,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}>
        [{label}]
      </Typography>
      <Box sx={{ flex: 1, height: '1px', bgcolor: colors.border.subtle }} />
    </Box>
  );
}

function ArticleListItem({
  item,
  selected,
  onSelect,
  onDelete,
}: {
  item: ArticleRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <Box
      onClick={onSelect}
      sx={{
        mb: 0.6,
        p: 0.9,
        borderRadius: 1.25,
        cursor: 'pointer',
        bgcolor: selected ? 'rgba(34, 211, 238, 0.08)' : colors.bg.tertiary,
        border: `1px solid ${selected ? colors.border.strong : colors.border.default}`,
        transition: 'border-color 120ms ease, background 120ms ease',
        '&:hover': { borderColor: colors.border.strong },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.35 }}>
            <Typography sx={{ fontSize: '0.5rem', color: colors.text.dim, fontFamily: MONO }}>
              {formatTime(item.createdAt)}
            </Typography>
            <Typography sx={{
              fontSize: '0.42rem',
              fontFamily: MONO,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: articleKindAccent(item.contentFormat),
              border: `1px solid ${alphaColor(articleKindAccent(item.contentFormat), '35')}`,
              bgcolor: alphaColor(articleKindAccent(item.contentFormat), '12'),
              px: 0.45,
              borderRadius: 0.5,
              lineHeight: 1.4,
            }}>
              {articleKindLabel(item.contentFormat)}
            </Typography>
          </Box>
          <Typography sx={{
            fontSize: '0.66rem',
            fontWeight: selected ? 700 : 600,
            color: colors.text.primary,
            fontFamily: "'JetBrains Mono', monospace",
            lineHeight: 1.25,
            mb: 0.3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {displayArticleTitle(item.title) || item.title}
          </Typography>
          {item.excerpt && (
            <Typography sx={{
              fontSize: '0.58rem',
              color: colors.text.secondary,
              lineHeight: 1.35,
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {humanizeArticleExcerpt(item.excerpt)}
            </Typography>
          )}
        </Box>
        <Tooltip title="Delete article">
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            sx={{ color: colors.text.dim, p: 0.25, '&:hover': { color: colors.accent.red } }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

export function ArticlesPanel() {
  const { events } = useApp();
  const [items, setItems] = useState<ArticleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ content?: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deletePendingId, setDeletePendingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(readListCollapsed);
  const [kindFilter, setKindFilter] = useState<ArticleKind | 'all'>('all');
  const selectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const { articles: list } = await articles.list({ limit: 100 });
      setItems(list);
      const currentSelectedId = selectedIdRef.current;
      if (list.length > 0 && !currentSelectedId) {
        setSelectedId(list[0]!.id);
      } else if (currentSelectedId && !list.some((c) => c.id === currentSelectedId)) {
        setSelectedId(list[0]?.id ?? null);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  useEffect(() => {
    const last = events[events.length - 1];
    if (last?.type === 'article_created') void loadList();
  }, [events, loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void articles.get(selectedId).then((payload) => {
      if (cancelled) return;
      setDetail(payload ? { content: payload.content } : null);
    }).catch(() => {
      if (!cancelled) setDetail(null);
    }).finally(() => {
      if (!cancelled) setDetailLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedId]);

  const selected = items.find((c) => c.id === selectedId) ?? null;
  const visibleItems = kindFilter === 'all'
    ? items
    : items.filter((item) => item.contentFormat === kindFilter);

  const handleDelete = async (id: string) => {
    try {
      await articles.delete(id);
      setItems((prev) => prev.filter((c) => c.id !== id));
      if (selectedId === id) {
        const rest = items.filter((c) => c.id !== id);
        setSelectedId(rest[0]?.id ?? null);
      }
    } catch { /* ignore */ }
  };

  const confirmDelete = async () => {
    if (!deletePendingId) return;
    setDeleteBusy(true);
    try {
      await handleDelete(deletePendingId);
      setDeletePendingId(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleListCollapsed = useCallback(() => {
    setListCollapsed((prev) => {
      const next = !prev;
      writeListCollapsed(next);
      return next;
    });
  }, []);

  const deletePendingItem = deletePendingId ? items.find((c) => c.id === deletePendingId) : null;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: colors.bg.primary }}>
      <PanelHeader
        title="Articles"
        subtitle="Articles, analysis, reports, insights — export as PDF"
        icon={<ArticleOutlinedIcon sx={{ fontSize: 18 }} />}
        action={(
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Tooltip title={listCollapsed ? 'Show list' : 'Hide list'}>
              <IconButton
                size="small"
                onClick={toggleListCollapsed}
                sx={{
                  display: { xs: 'none', md: 'inline-flex' },
                  color: colors.text.dim,
                  '&:hover': { color: colors.text.primary },
                }}
              >
                {listCollapsed
                  ? <ChevronRightIcon sx={{ fontSize: 18 }} />
                  : <ChevronLeftIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={() => void loadList()} sx={{ color: colors.text.dim }}>
                <RefreshIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      />

      <Box sx={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
        <Box sx={{
          width: {
            xs: '100%',
            md: listCollapsed ? 0 : PANEL_SIDE_LIST_WIDTH,
          },
          minWidth: {
            xs: 0,
            md: listCollapsed ? 0 : PANEL_SIDE_LIST_WIDTH,
          },
          flexShrink: 0,
          borderRight: {
            md: listCollapsed ? 'none' : `1px solid ${colors.border.default}`,
          },
          borderBottom: { xs: `1px solid ${colors.border.default}`, md: 'none' },
          overflow: { xs: 'auto', md: listCollapsed ? 'hidden' : 'auto' },
          p: { xs: 1, md: listCollapsed ? 0 : 1 },
          bgcolor: colors.bg.secondary,
          pointerEvents: { md: listCollapsed ? 'none' : 'auto' },
          display: {
            xs: selected ? 'none' : 'block',
            md: 'block',
          },
          transition: 'width 180ms ease, min-width 180ms ease, padding 180ms ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={22} />
            </Box>
          ) : items.length === 0 ? (
            <Typography sx={{ color: colors.text.dim, fontSize: '0.7rem', textAlign: 'center', py: 4, fontFamily: "'JetBrains Mono', monospace" }}>
              No articles yet. Ask Agent-X to save a response as an article, analysis, report, or insight.
            </Typography>
          ) : (
            <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, mb: 1 }}>
              {(['all', 'article', 'analysis', 'report', 'insight'] as const).map((key) => {
                const active = kindFilter === key;
                const label = key === 'all' ? 'All' : articleKindLabel(key);
                const accent = key === 'all' ? colors.accent.cyan : articleKindAccent(key);
                return (
                  <Box
                    key={key}
                    onClick={() => setKindFilter(key)}
                    sx={{
                      px: 0.65,
                      py: 0.2,
                      borderRadius: 0.75,
                      cursor: 'pointer',
                      fontSize: '0.48rem',
                      fontFamily: MONO,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: active ? accent : colors.text.dim,
                      border: `1px solid ${active ? alphaColor(accent, '45') : colors.border.subtle}`,
                      bgcolor: active ? alphaColor(accent, '12') : 'transparent',
                    }}
                  >
                    {label}
                  </Box>
                );
              })}
            </Box>
            {visibleItems.length === 0 ? (
              <Typography sx={{ color: colors.text.dim, fontSize: '0.65rem', textAlign: 'center', py: 3, fontFamily: MONO }}>
                Nothing in this kind yet.
              </Typography>
            ) : groupArticlesByDay(visibleItems).map((group, groupIdx) => (
              <Box key={group.dayKey || `ungrouped-${groupIdx}`}>
                {group.label ? (
                  <DateGroupDivider label={group.label} first={groupIdx === 0} />
                ) : null}
                {group.items.map((item) => (
                  <ArticleListItem
                    key={item.id}
                    item={item}
                    selected={item.id === selectedId}
                    onSelect={() => setSelectedId(item.id)}
                    onDelete={() => setDeletePendingId(item.id)}
                  />
                ))}
              </Box>
            ))}
            </>
          )}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: { xs: selected ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column' }}>
          {detailLoading ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          ) : selected && !detail ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
              <Typography sx={{ color: colors.accent.red, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>
                Failed to load article
              </Typography>
            </Box>
          ) : selected ? (
            <ArticleViewer
              document={selected}
              content={detail?.content}
              onBack={() => setSelectedId(null)}
            />
          ) : (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
              <Typography sx={{ color: colors.text.dim, fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace", textAlign: 'center' }}>
                Select an article to view
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <ConfirmDeleteDialog
        open={Boolean(deletePendingId)}
        busy={deleteBusy}
        title="DELETE ARTICLE"
        description="Permanently delete"
        itemName={deletePendingItem?.title ?? deletePendingItem?.id ?? 'this article'}
        onClose={() => setDeletePendingId(null)}
        onConfirm={() => { void confirmDelete(); }}
      />
    </Box>
  );
}
