import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Popover from '@mui/material/Popover';
import CheckIcon from '@mui/icons-material/Check';
import { colors, alphaColor } from '../../theme';
import type { ThinkingMode, OutputMode } from '@agentx/shared';
import { THINKING_MODE_LABELS, OUTPUT_MODE_LABELS } from '@agentx/shared';

type ModeKind = 'thinking' | 'output';

interface TurnModeChipProps {
  kind: ModeKind;
  value: string;
  onChange: (value: string) => void;
}

const THINKING_DESCRIPTIONS: Record<ThinkingMode, string> = {
  light: 'Minimal tools (max 3). RAG only if mentioned. Limited internet (1-3 sites). No reasoning.',
  medium: 'Moderate tools (~50%). RAG on. Internet on. Moderate reasoning.',
  high: 'All tools. Full journey: Memory + RAG + Internet + Knowledge. Max reasoning.',
};

const OUTPUT_DESCRIPTIONS: Record<OutputMode, string> = {
  brief: '2-3 sentences max. Direct answer, no formatting.',
  moderate: '~500 chars. Tables/bullets for structured data. Concise.',
  detailed: 'Full detail. Sections, tables, citations. Hallucination-guarded.',
};

const THINKING_VALUES: ThinkingMode[] = ['light', 'medium', 'high'];
const OUTPUT_VALUES: OutputMode[] = ['brief', 'moderate', 'detailed'];

const ACCENT_COLORS: Record<ModeKind, string> = {
  thinking: colors.accent.purple,
  output: colors.accent.cyan,
};

export function TurnModeChip({ kind, value, onChange }: TurnModeChipProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const isThinking = kind === 'thinking';
  const label = isThinking
    ? `Thinking: ${THINKING_MODE_LABELS[value as ThinkingMode] ?? 'Medium'}`
    : `Output: ${OUTPUT_MODE_LABELS[value as OutputMode] ?? 'Moderate'}`;
  const tooltip = isThinking ? 'Thinking Mode — controls effort and tool usage' : 'Output Mode — controls response verbosity';
  const accent = ACCENT_COLORS[kind];
  const options: string[] = isThinking ? THINKING_VALUES : OUTPUT_VALUES;
  const descriptions: Record<string, string> = isThinking
    ? THINKING_DESCRIPTIONS as unknown as Record<string, string>
    : OUTPUT_DESCRIPTIONS as unknown as Record<string, string>;
  const optionLabels: Record<string, string> = isThinking
    ? THINKING_MODE_LABELS as unknown as Record<string, string>
    : OUTPUT_MODE_LABELS as unknown as Record<string, string>;

  return (
    <>
      <Tooltip title={tooltip} arrow>
        <Chip
          size="small"
          label={label}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{
            fontSize: '0.55rem',
            height: 20,
            cursor: 'pointer',
            bgcolor: colors.bg.tertiary,
            border: `1px solid ${value && value !== (isThinking ? 'medium' : 'moderate') ? alphaColor(accent, '40') : colors.border.default}`,
            borderRadius: '10px',
            color: value && value !== (isThinking ? 'medium' : 'moderate') ? accent : colors.text.dim,
            '&:hover': { bgcolor: colors.bg.primary },
            '& .MuiChip-label': { px: 1 },
          }}
        />
      </Tooltip>
      <Popover
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{
          sx: {
            bgcolor: colors.bg.secondary,
            border: `1px solid ${colors.border.default}`,
            borderRadius: 1,
            minWidth: 220,
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          },
        }}
      >
        <MenuList dense sx={{ py: 0.5 }}>
          <Box sx={{ px: 1.5, py: 0.5 }}>
            <Typography sx={{
              fontSize: '0.5rem',
              fontFamily: "'JetBrains Mono', monospace",
              color: colors.text.dim,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}>
              {isThinking ? 'Thinking Mode' : 'Output Mode'}
            </Typography>
          </Box>
          {options.map((opt) => {
            const isSelected = opt === value;
            return (
              <MenuItem
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setAnchorEl(null);
                }}
                selected={isSelected}
                sx={{
                  fontSize: '0.65rem',
                  py: 0.5,
                  px: 1.5,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 0.5,
                  '&:hover': { bgcolor: alphaColor(accent, '10') },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography sx={{
                      fontSize: '0.65rem',
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? accent : colors.text.primary,
                    }}>
                      {optionLabels[opt]}
                    </Typography>
                    {isSelected && (
                      <CheckIcon sx={{ fontSize: 12, color: accent }} />
                    )}
                  </Box>
                  <Typography sx={{
                    fontSize: '0.5rem',
                    color: colors.text.dim,
                    mt: 0.25,
                    lineHeight: 1.3,
                  }}>
                    {descriptions[opt]}
                  </Typography>
                </Box>
              </MenuItem>
            );
          })}
        </MenuList>
      </Popover>
    </>
  );
}
