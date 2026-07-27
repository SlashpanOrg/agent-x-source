/** Minimal JSON tree with syntax highlighting + collapsible nodes (§11.11). */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { obs, obsMonoSx } from '../obs-theme';

function syntaxHighlight(json: string): string {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string';
        else if (/true|false/.test(match)) cls = 'json-boolean';
        else if (/null/.test(match)) cls = 'json-null';
        return `<span class="${cls}">${match}</span>`;
      });
}

export function JsonViewer({ data, maxHeight = 400 }: { data: unknown; maxHeight?: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const json = JSON.stringify(data, null, 2);
  const lines = json.split('\n').length;

  if (lines > 20 && collapsed) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <IconButton size="small" onClick={() => setCollapsed(false)} sx={{ color: obs.text.dim }}>
          <ChevronRightIcon fontSize="inherit" />
        </IconButton>
        <Typography sx={{ ...obsMonoSx, fontSize: '0.6rem', color: obs.text.dim, cursor: 'pointer' }} onClick={() => setCollapsed(false)}>
          {lines} lines (click to expand)
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative', maxHeight, bgcolor: obs.bg.void, border: `1px solid ${obs.border.subtle}`, borderRadius: '5px' }}>
      {lines > 20 && (
        <IconButton size="small" onClick={() => setCollapsed(true)} sx={{ position: 'absolute', top: 2, right: 2, color: obs.text.dim, zIndex: 1 }}>
          <ExpandMoreIcon fontSize="inherit" />
        </IconButton>
      )}
      <Box
        component="pre"
        className="ax-scroll"
        sx={{
          maxHeight,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11.5,
          lineHeight: 1.55,
          margin: 0,
          padding: 1,
          color: obs.text.secondary,
          '& .json-key': { color: obs.accent.purple },
          '& .json-string': { color: obs.accent.signal },
          '& .json-number': { color: obs.accent.amber },
          '& .json-boolean': { color: obs.accent.cyan },
          '& .json-null': { color: obs.accent.alert },
        }}
        dangerouslySetInnerHTML={{ __html: syntaxHighlight(json) }}
      />
    </Box>
  );
}
