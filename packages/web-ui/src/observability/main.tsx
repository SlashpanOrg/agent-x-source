/** Observability app entry point (§11.2). */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { BrowserRouter } from 'react-router-dom';
import { THEME_MODE_STORAGE_KEY } from '../theme';
import { observabilityTheme } from './obs-theme';
import { App } from './App';
import { ObservabilityProvider } from './context';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename="/observability">
      {/* Same theme + mode-storage key as the main console (theme.ts) — the
          Observability window always mirrors the console's dark/light choice. */}
      <ThemeProvider
        theme={observabilityTheme}
        defaultMode="dark"
        modeStorageKey={THEME_MODE_STORAGE_KEY}
        disableTransitionOnChange
        noSsr
      >
        <CssBaseline />
        <ObservabilityProvider>
          <App />
        </ObservabilityProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
