import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';
import type { UserGender } from '@agentx/shared';
import {
  USER_GENDER_LABELS,
  USER_GENDERS,
  USER_HONORIFIC_PREFIXES,
  isOwnerEmailValid,
  normalizeOwnerNames,
} from '@agentx/shared';

/** Non-empty sentinel so the Prefix label shrinks instead of overlapping "None". */
const PREFIX_NONE = '__none__';

export interface OwnerIdentityValue {
  callsign: string;
  names: string[];
  /** Live chip-input text; not persisted until Enter / blur. */
  nameInput: string;
  prefix: string;
  gender: UserGender | '';
  email: string;
}

interface Props {
  value: OwnerIdentityValue;
  onChange: (next: OwnerIdentityValue) => void;
  textFieldSx?: SxProps<Theme>;
  slotProps?: object;
  selectSx?: SxProps<Theme>;
}

export function ownerIdentityReady(value: OwnerIdentityValue): boolean {
  const names = normalizeOwnerNames({ names: [...value.names, value.nameInput] });
  return Boolean(value.callsign.trim() && names.length > 0 && isOwnerEmailValid(value.email));
}

export function OwnerIdentityFields({ value, onChange, textFieldSx, slotProps, selectSx }: Props) {
  const patch = (partial: Partial<OwnerIdentityValue>) => onChange({ ...value, ...partial });
  const emailError = value.email.trim() !== '' && !isOwnerEmailValid(value.email);
  const selectFieldSx = [textFieldSx, selectSx] as SxProps<Theme>;

  const commitName = (raw?: string) => {
    const next = normalizeOwnerNames({ names: [...value.names, raw ?? value.nameInput] });
    onChange({ ...value, names: next, nameInput: '' });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75 }}>
      <TextField
        size="small"
        label="Callsign"
        value={value.callsign}
        onChange={(e) => patch({ callsign: e.target.value })}
        placeholder="e.g. Commander"
        fullWidth
        sx={textFieldSx}
        slotProps={slotProps}
        helperText="How Agent-X addresses you — dashboard, voice, and WhatsApp self-chat."
      />

      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', opacity: 0.7, mt: 0.5 }}>
        Public identity — for other people
      </Typography>
      <Typography sx={{ fontSize: '0.75rem', lineHeight: 1.5, opacity: 0.75 }}>
        When Agent-X messages your contacts on your behalf, it picks one of these names at random — never your callsign.
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '140px 1fr' }, gap: 1.25, alignItems: 'start' }}>
        <TextField
          select
          size="small"
          label="Prefix"
          value={value.prefix || PREFIX_NONE}
          onChange={(e) => {
            const next = String(e.target.value);
            patch({ prefix: next === PREFIX_NONE ? '' : next });
          }}
          fullWidth
          sx={selectFieldSx}
          slotProps={slotProps}
        >
          <MenuItem value={PREFIX_NONE}>None</MenuItem>
          {USER_HONORIFIC_PREFIXES.map((p) => (
            <MenuItem key={p} value={p}>{p}</MenuItem>
          ))}
        </TextField>
        <Box>
          <TextField
            size="small"
            label="Names or nicknames"
            value={value.nameInput}
            onChange={(e) => patch({ nameInput: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitName();
              } else if (e.key === 'Backspace' && !value.nameInput && value.names.length) {
                patch({ names: value.names.slice(0, -1) });
              }
            }}
            onBlur={() => {
              if (value.nameInput.trim()) commitName();
            }}
            placeholder={value.names.length ? 'Add another' : 'e.g. Siva'}
            fullWidth
            sx={textFieldSx}
            slotProps={slotProps}
            helperText="Type a name and press Enter. Agent-X uses any of these at random."
          />
          {value.names.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.75 }}>
              {value.names.map((n) => (
                <Chip
                  key={n}
                  label={n}
                  size="small"
                  onMouseDown={(e) => e.preventDefault()}
                  onDelete={() => patch({ names: value.names.filter((x) => x !== n) })}
                  sx={{
                    height: 22,
                    fontSize: '0.7rem',
                    '& .MuiChip-deleteIcon': { fontSize: 14 },
                  }}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
        <TextField
          select
          size="small"
          label="Gender"
          value={value.gender || 'unspecified'}
          onChange={(e) => patch({ gender: e.target.value as UserGender })}
          fullWidth
          sx={selectFieldSx}
          slotProps={slotProps}
        >
          {USER_GENDERS.map((g) => (
            <MenuItem key={g} value={g}>{USER_GENDER_LABELS[g]}</MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Email (optional)"
          value={value.email}
          onChange={(e) => patch({ email: e.target.value })}
          placeholder="you@example.com"
          fullWidth
          error={emailError}
          helperText={emailError ? 'Enter a valid email, or leave blank.' : 'Stored for later tasks that need it. Never used as a greeting.'}
          sx={textFieldSx}
          slotProps={slotProps}
        />
      </Box>
    </Box>
  );
}
