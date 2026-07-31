import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { integrations, type IntegrationNotification } from '../../api';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';
import { colors, alphaColor } from '../../theme';

const KIND_LABEL: Record<IntegrationNotification['kind'], string> = {
  benchmark_error: 'Probe',
  runtime_error: 'Runtime',
  sync_error: 'Sync',
};

export function IntegrationNotificationsPanel({ onOpenProvider }: {
  onOpenProvider?: (providerId: string) => void;
}) {
  const [items, setItems] = useState<IntegrationNotification[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await integrations.notifications(100);
      setItems(res.notifications);
      setCount(res.count);
    } catch {
      setItems([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const dismiss = async (id: string) => {
    await integrations.dismissNotification(id);
    await refresh();
  };

  const dismissAll = async () => {
    await integrations.dismissAllNotifications();
    await refresh();
  };

  return (
    <Box sx={{ mb: 3, p: 2, borderRadius: 1.5, border: `1px solid ${settingsTheme.border.default}`, bgcolor: settingsTheme.bg.panel }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, ...settingsMonoSx }}>
          MCP alerts {count > 0 ? `(${count})` : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          {count > 0 && (
            <Button size="small" onClick={() => { void dismissAll(); }} sx={{ fontSize: '0.55rem', ...settingsMonoSx }}>
              Dismiss all
            </Button>
          )}
          <Button size="small" onClick={() => { void refresh(); }} sx={{ fontSize: '0.55rem', ...settingsMonoSx }}>
            Refresh
          </Button>
        </Box>
      </Box>

      <Typography sx={{ fontSize: '0.62rem', color: settingsTheme.text.dim, mb: 1.5, lineHeight: 1.5, ...settingsMonoSx }}>
        Read tools are probed on connect/sync. Write/update failures appear here when they happen.
      </Typography>

      {loading ? (
        <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>Loading…</Typography>
      ) : items.length === 0 ? (
        <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
          No MCP errors right now.
        </Typography>
      ) : (
        <Box sx={{ maxHeight: 420, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {items.map((item) => (
            <NotificationItem key={item.id} item={item} onOpenProvider={onOpenProvider} onDismiss={dismiss} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function NotificationItem({
  item,
  onOpenProvider,
  onDismiss,
}: {
  item: IntegrationNotification;
  onOpenProvider?: (providerId: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLongMessage = item.message.length > 120;

  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: '6px',
        border: `1px solid ${alphaColor(colors.accent.red, '44')}`,
        bgcolor: alphaColor(colors.accent.red, '10'),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
        <Chip
          size="small"
          label={KIND_LABEL[item.kind]}
          sx={{
            height: 18,
            fontSize: '0.5rem',
            bgcolor: alphaColor(colors.accent.red, '22'),
            color: colors.accent.red,
          }}
        />
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: settingsTheme.text.primary, ...settingsMonoSx }}>
          {item.displayName}
        </Typography>
        {item.toolName && (
          <Typography sx={{ fontSize: '0.58rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
            · {item.toolName}
          </Typography>
        )}
        <Typography sx={{ fontSize: '0.52rem', color: settingsTheme.text.dim, ml: 'auto', ...settingsMonoSx }}>
          {new Date(item.createdAt).toLocaleString()}
        </Typography>
      </Box>

      {isLongMessage ? (
        <>
          <Box
            sx={{ cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
            onClick={() => setExpanded(!expanded)}
          >
            <Typography
              sx={{
                fontSize: '0.72rem',
                color: settingsTheme.accent.alert,
                lineHeight: 1.45,
                ...settingsMonoSx,
                overflow: 'hidden',
                display: expanded ? 'none' : '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {item.message}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, mt: 0.25 }}>
              <IconButton size="small" sx={{ p: 0, width: 16, height: 16 }}>
                {expanded
                  ? <ExpandLessIcon sx={{ fontSize: '0.7rem' }} />
                  : <ExpandMoreIcon sx={{ fontSize: '0.7rem' }} />}
              </IconButton>
              <Typography sx={{ fontSize: '0.45rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
                {expanded ? 'Show less' : 'Show full error'}
              </Typography>
            </Box>
          </Box>
          <Collapse in={expanded}>
            <Box
              component="pre"
              sx={{
                fontSize: '0.55rem',
                fontFamily: "'JetBrains Mono', monospace",
                color: settingsTheme.accent.alert,
                bgcolor: alphaColor(colors.accent.red, '8'),
                border: `1px solid ${alphaColor(colors.accent.red, '30')}`,
                borderRadius: 0.5,
                p: 0.75,
                m: 0,
                mt: 0.5,
                maxHeight: 250,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {item.message}
            </Box>
          </Collapse>
        </>
      ) : (
        <Typography sx={{ fontSize: '0.72rem', color: settingsTheme.accent.alert, lineHeight: 1.45, ...settingsMonoSx }}>
          {item.message}
        </Typography>
      )}

      <Box sx={{ display: 'flex', gap: 1, mt: 0.75 }}>
        {onOpenProvider && (
          <Button
            size="small"
            onClick={() => onOpenProvider(item.providerId)}
            sx={{ fontSize: '0.55rem', textTransform: 'none', color: settingsTheme.text.secondary }}
          >
            Open integration
          </Button>
        )}
        <Button
          size="small"
          onClick={() => { void onDismiss(item.id); }}
          sx={{ fontSize: '0.55rem', textTransform: 'none', color: settingsTheme.text.dim }}
        >
          Dismiss
        </Button>
      </Box>
    </Box>
  );
}
