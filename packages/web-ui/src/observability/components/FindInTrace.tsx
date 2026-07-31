/** Find-in-trace search box (§11.5) — Ctrl+F to search span names + attributes. */
import { useState, useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import CloseIcon from '@mui/icons-material/Close';
import { obs, obsMonoSx } from '../obs-theme';

export function FindInTrace({
  matches,
  currentMatch,
  onQueryChange,
  onPrev,
  onNext,
  onClose,
}: {
  matches: number;
  currentMatch: number;
  onQueryChange: (q: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        ref.current?.focus();
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, border: `1px solid ${obs.border.hud}`, borderRadius: '6px', bgcolor: obs.bg.panel }}>
      <SearchIcon sx={{ fontSize: 15, color: obs.text.dim }} />
      <TextField
        inputRef={ref}
        size="small"
        placeholder="Find in trace…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); onQueryChange(e.target.value); }}
        sx={{ width: 160, '& .MuiInputBase-input': { fontSize: '0.68rem', py: 0.4, fontFamily: "'JetBrains Mono', monospace" } }}
        variant="standard"
      />
      {query && (
        <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, minWidth: 36 }}>
          {currentMatch}/{matches}
        </Typography>
      )}
      <IconButton size="small" onClick={onPrev} disabled={!query} sx={{ color: obs.text.dim }}><NavigateBeforeIcon sx={{ fontSize: 16 }} /></IconButton>
      <IconButton size="small" onClick={onNext} disabled={!query} sx={{ color: obs.text.dim }}><NavigateNextIcon sx={{ fontSize: 16 }} /></IconButton>
      <IconButton size="small" onClick={onClose} sx={{ color: obs.text.dim }}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
    </Box>
  );
}
