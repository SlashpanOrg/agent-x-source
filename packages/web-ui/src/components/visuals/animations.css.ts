export const VISUAL_STYLES = `
  /* Streaming cursor blink */
  @keyframes ax-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  /* Pulse animation for running tools */
  @keyframes ax-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  /* Shimmer/skeleton loading */
  @keyframes ax-shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  /* Spin for loading indicators */
  @keyframes ax-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Bounce for reading dots */
  @keyframes ax-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40% { transform: translateY(-3px); opacity: 1; }
  }

  /* Fade in for tool cards */
  @keyframes ax-fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Tool card status classes */
  .ax-tool-pending { color: var(--ax-toolPending); }
  .ax-tool-running { color: var(--ax-toolRunning); animation: ax-pulse 1.5s ease-in-out infinite; }
  .ax-tool-ok { color: var(--ax-toolCompleted); animation: ax-fadeIn var(--ax-duration-normal) var(--ax-ease-out); }
  .ax-tool-error { color: var(--ax-toolError); animation: ax-fadeIn var(--ax-duration-normal) var(--ax-ease-out); }
  .ax-tool-denied { color: var(--ax-toolDenied); text-decoration: line-through; }

  /* Streaming cursor */
  .ax-streaming-cursor { animation: ax-blink 1s step-end infinite; display: inline; color: var(--ax-accent); }

  /* Spinner */
  .ax-spinner { animation: ax-spin 0.8s linear infinite; display: inline-flex; }

  /* Reading/typing dots */
  .ax-dot-bounce { animation: ax-bounce 1.2s ease-in-out infinite; }
  .ax-dot-bounce:nth-child(2) { animation-delay: 0.15s; }
  .ax-dot-bounce:nth-child(3) { animation-delay: 0.3s; }

  /* Session live pulse */
  .ax-session-live { animation: ax-pulse 1.8s ease-in-out infinite; }

  /* Respect reduced motion preference */
  @media (prefers-reduced-motion: reduce) {
    *, ::before, ::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

/**
 * Inject visual animation styles into the document head.
 * Safe to call multiple times — only injects once.
 */
export function injectVisualStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ax-visual-styles')) return;

  const style = document.createElement('style');
  style.id = 'ax-visual-styles';
  style.textContent = VISUAL_STYLES;
  document.head.appendChild(style);
}
