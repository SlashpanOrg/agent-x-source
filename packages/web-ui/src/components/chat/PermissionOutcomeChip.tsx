import { memo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { PermissionOutcomeRecord } from '@agentx/shared/browser';
import { colors, alphaColor, MONO } from '../../theme';

function toneFor(decision: PermissionOutcomeRecord['decision']): { fg: string; bg: string; border: string } {
  switch (decision) {
    case 'allow_once':
    case 'allow_always':
      return {
        fg: colors.accent.green,
        bg: alphaColor(colors.accent.green, '12'),
        border: alphaColor(colors.accent.green, '28'),
      };
    case 'instructed':
      return {
        fg: colors.accent.blue,
        bg: alphaColor(colors.accent.blue, '12'),
        border: alphaColor(colors.accent.blue, '28'),
      };
    case 'declined_consent':
    case 'deny':
    default:
      return {
        fg: colors.accent.orange,
        bg: alphaColor(colors.accent.orange, '12'),
        border: alphaColor(colors.accent.orange, '28'),
      };
  }
}

export const PermissionOutcomeChip = memo(function PermissionOutcomeChip({
  record,
}: {
  record: PermissionOutcomeRecord;
}) {
  const tone = toneFor(record.decision);
  const action = record.actionSummary
    ?? (record.path ? `${record.toolName ?? record.toolId} · ${record.path}` : (record.toolName ?? record.toolId));
  const detail = record.instruction?.trim();

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'flex-start',
        gap: 0.75,
        maxWidth: '100%',
        px: 1,
        py: 0.5,
        borderRadius: 1,
        border: `1px solid ${tone.border}`,
        bgcolor: tone.bg,
        animation: 'agentx-fadeIn 0.25s ease-out',
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: '0.65rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
          color: tone.fg,
          whiteSpace: 'nowrap',
          lineHeight: 1.4,
          pt: detail ? '1px' : 0,
        }}
      >
        {record.label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: '0.7rem',
            color: colors.text.secondary,
            fontFamily: MONO,
            lineHeight: 1.35,
            wordBreak: 'break-word',
          }}
        >
          {action}
        </Typography>
        {detail ? (
          <Typography
            sx={{
              mt: 0.25,
              fontSize: '0.65rem',
              color: colors.text.tertiary,
              lineHeight: 1.35,
              wordBreak: 'break-word',
            }}
          >
            {detail}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
});
