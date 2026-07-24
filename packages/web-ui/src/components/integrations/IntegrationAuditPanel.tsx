import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { integrations } from '../../api';
import { settingsTheme, settingsMonoSx } from '../../styles/settings-theme';

import { colors, alphaColor } from '../../theme';

interface AuditEntry {
  id: string;
  timestamp: string;
  connectionId: string;
  providerId: string;
  toolName: string;
  toolId: string;
  readonly: boolean;
  success: boolean;
  error?: string;
  argsSummary?: string;
  input?: string;
  output?: string;
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(entry.input || entry.output || entry.error);

  return (
    <Box
      sx={{
        borderBottom: `1px solid ${alphaColor(settingsTheme.border.default, '40')}`,
      }}
    >
      <Box
        sx={{
          py: 0.75,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 0.5,
          alignItems: 'center',
          cursor: hasDetails ? 'pointer' : 'default',
          '&:hover': hasDetails ? { bgcolor: alphaColor(settingsTheme.bg.elevated, '50') } : {},
        }}
        onClick={() => hasDetails && setExpanded(!expanded)}
      >
        {hasDetails && (
          <IconButton size="small" sx={{ p: 0, width: 16, height: 16 }}>
            {expanded ? <ExpandLessIcon sx={{ fontSize: '0.7rem' }} /> : <ExpandMoreIcon sx={{ fontSize: '0.7rem' }} />}
          </IconButton>
        )}
        <Chip
          size="small"
          label={entry.success ? 'OK' : 'FAIL'}
          sx={{
            height: 16,
            fontSize: '0.45rem',
            bgcolor: entry.success ? alphaColor(colors.accent.green, '22') : alphaColor(colors.accent.red, '22'),
            color: entry.success ? colors.accent.green : colors.accent.red,
          }}
        />
        <Chip
          size="small"
          label={entry.readonly ? 'READ' : 'WRITE'}
          sx={{
            height: 16,
            fontSize: '0.4rem',
            bgcolor: alphaColor(settingsTheme.bg.elevated, '80'),
            color: settingsTheme.text.dim,
          }}
        />
        <Typography sx={{ fontSize: '0.55rem', fontFamily: "'JetBrains Mono', monospace", color: settingsTheme.text.primary }}>
          {entry.providerId}:{entry.toolName}
        </Typography>
        <Typography sx={{ fontSize: '0.5rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>
          {new Date(entry.timestamp).toLocaleString()}
        </Typography>
        {entry.argsSummary && (
          <Typography sx={{ fontSize: '0.5rem', color: settingsTheme.text.secondary, width: '100%', ...settingsMonoSx, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.argsSummary}
          </Typography>
        )}
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ pb: 1, px: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {entry.connectionId && (
            <Box>
              <Typography sx={{ fontSize: '0.45rem', fontWeight: 700, color: settingsTheme.text.dim, ...settingsMonoSx, mb: 0.25 }}>
                CONNECTION
              </Typography>
              <Typography sx={{ fontSize: '0.5rem', color: settingsTheme.text.secondary, ...settingsMonoSx, wordBreak: 'break-all' }}>
                {entry.connectionId}
              </Typography>
            </Box>
          )}
          {entry.input && (
            <Box>
              <Typography sx={{ fontSize: '0.45rem', fontWeight: 700, color: settingsTheme.text.dim, ...settingsMonoSx, mb: 0.25 }}>
                INPUT
              </Typography>
              <Box
                component="pre"
                sx={{
                  fontSize: '0.5rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: settingsTheme.text.primary,
                  bgcolor: alphaColor(settingsTheme.bg.elevated, '60'),
                  border: `1px solid ${settingsTheme.border.default}`,
                  borderRadius: 0.5,
                  p: 0.75,
                  m: 0,
                  maxHeight: 200,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {entry.input}
              </Box>
            </Box>
          )}
          {entry.output && (
            <Box>
              <Typography sx={{ fontSize: '0.45rem', fontWeight: 700, color: entry.success ? settingsTheme.text.dim : colors.accent.red, ...settingsMonoSx, mb: 0.25 }}>
                {entry.success ? 'OUTPUT' : 'ERROR'}
              </Typography>
              <Box
                component="pre"
                sx={{
                  fontSize: '0.5rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: entry.success ? settingsTheme.text.primary : colors.accent.red,
                  bgcolor: entry.success
                    ? alphaColor(settingsTheme.bg.elevated, '60')
                    : alphaColor(colors.accent.red, '8'),
                  border: `1px solid ${entry.success ? settingsTheme.border.default : alphaColor(colors.accent.red, '30')}`,
                  borderRadius: 0.5,
                  p: 0.75,
                  m: 0,
                  maxHeight: 300,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {entry.output}
              </Box>
            </Box>
          )}
          {entry.error && !entry.output && (
            <Box>
              <Typography sx={{ fontSize: '0.45rem', fontWeight: 700, color: colors.accent.red, ...settingsMonoSx, mb: 0.25 }}>
                ERROR
              </Typography>
              <Box
                component="pre"
                sx={{
                  fontSize: '0.5rem',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: colors.accent.red,
                  bgcolor: alphaColor(colors.accent.red, '8'),
                  border: `1px solid ${alphaColor(colors.accent.red, '30')}`,
                  borderRadius: 0.5,
                  p: 0.75,
                  m: 0,
                  maxHeight: 200,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {entry.error}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

export function IntegrationAuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await integrations.audit(100);
      setEntries(res.entries);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <Box sx={{
      flex: 1,
      minHeight: 0,
      height: '100%',
      p: 2,
      borderRadius: 1.5,
      border: `1px solid ${settingsTheme.border.default}`,
      bgcolor: settingsTheme.bg.panel,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexShrink: 0 }}>
        <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, ...settingsMonoSx }}>
          Audit log
        </Typography>
        <Button size="small" onClick={() => { void refresh(); }} sx={{ fontSize: '0.55rem', ...settingsMonoSx }}>
          Refresh
        </Button>
      </Box>

      {loading ? (
        <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>Loading…</Typography>
      ) : entries.length === 0 ? (
        <Typography sx={{ fontSize: '0.6rem', color: settingsTheme.text.dim, ...settingsMonoSx }}>No integration tool calls yet.</Typography>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {entries.slice().reverse().map((entry) => (
            <AuditEntryRow key={entry.id} entry={entry} />
          ))}
        </Box>
      )}
    </Box>
  );
}
