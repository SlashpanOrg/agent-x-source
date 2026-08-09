/**
 * Standalone HTML for OAuth browser callback — Agent-X branded result screen.
 * Served when Accept includes text/html (browser redirect from Google/GitHub/etc).
 */

export interface OAuthResultPageMeta {
  connectionId?: string;
  providerId?: string;
}

/** Agent-X dark theme tokens (mirrors web-ui theme.ts SCHEMES.dark). */
const AX = {
  bg: '#030308',
  surface: '#0a0a12',
  elevated: '#12121c',
  border: '#242432',
  borderGlow: '#484860',
  text: '#f2f3f7',
  textSecondary: '#b4b8c4',
  textDim: '#656878',
  blue: '#7dd3fc',
  cyan: '#67e8f9',
  green: '#4ade80',
  red: '#f87171',
  purple: '#c4b5fd',
} as const;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatProviderLabel(providerId?: string): string | null {
  if (!providerId?.trim()) return null;
  return providerId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function oauthResultPage(
  success: boolean,
  message: string,
  meta?: OAuthResultPageMeta,
): string {
  const providerLabel = formatProviderLabel(meta?.providerId);
  const accent = success ? AX.green : AX.red;
  const accentSoft = success ? AX.cyan : AX.red;
  const statusTitle = success ? 'Connection Established' : 'Authorization Failed';
  const statusSubtitle = success
    ? 'Your integration is live — tools are syncing into Agent-X.'
    : 'We could not complete the OAuth handshake.';
  const footerHint = success
    ? 'Return to Agent-X — your integration is connected and tools are syncing.'
    : 'Close this tab, return to Agent-X, and click Sign in again to retry.';

  const payload = JSON.stringify({
    type: 'agentx-integration-oauth',
    success,
    message,
    ...(meta?.connectionId ? { connectionId: meta.connectionId } : {}),
    ...(meta?.providerId ? { providerId: meta.providerId } : {}),
  });

  const providerBadge = providerLabel
    ? `<span class="provider-badge">${escapeHtml(providerLabel)}</span>`
    : '';

  const connectionMeta = meta?.connectionId
    ? `<div class="meta-row"><span class="meta-label">Connection</span><code class="meta-value">${escapeHtml(meta.connectionId.slice(0, 12))}…</code></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Agent-X · Integration ${success ? 'Connected' : 'Failed'}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }

  html, body {
    margin: 0;
    min-height: 100vh;
    background: ${AX.bg};
    color: ${AX.text};
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  body {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow: hidden;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
  }

  .aurora {
    position: absolute;
    width: 140%;
    height: 140%;
    top: -20%;
    left: -20%;
    background:
      radial-gradient(ellipse 55% 45% at 20% 30%, color-mix(in srgb, ${AX.cyan} 18%, transparent), transparent 60%),
      radial-gradient(ellipse 50% 40% at 80% 20%, color-mix(in srgb, ${AX.purple} 14%, transparent), transparent 55%),
      radial-gradient(ellipse 45% 50% at 60% 85%, color-mix(in srgb, ${AX.blue} 12%, transparent), transparent 50%);
    animation: aurora-drift 14s ease-in-out infinite alternate;
  }

  @keyframes aurora-drift {
    0% { transform: translate(0, 0) scale(1); }
    100% { transform: translate(-3%, 2%) scale(1.04); }
  }

  .grid {
    position: absolute;
    inset: 0;
    opacity: 0.35;
    background-image:
      linear-gradient(color-mix(in srgb, ${AX.border} 40%, transparent) 1px, transparent 1px),
      linear-gradient(90deg, color-mix(in srgb, ${AX.border} 40%, transparent) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(ellipse 70% 60% at 50% 45%, black 20%, transparent 75%);
  }

  .scanline {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      color-mix(in srgb, ${AX.text} 2%, transparent) 2px,
      color-mix(in srgb, ${AX.text} 2%, transparent) 4px
    );
    opacity: 0.15;
  }

  .shell {
    position: relative;
    z-index: 1;
    width: min(440px, 100%);
    animation: shell-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes shell-in {
    from { opacity: 0; transform: translateY(16px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .card {
    position: relative;
    border-radius: 20px;
    padding: 2px;
    background: linear-gradient(
      135deg,
      color-mix(in srgb, ${accentSoft} 55%, transparent),
      color-mix(in srgb, ${AX.purple} 35%, transparent),
      color-mix(in srgb, ${AX.border} 80%, transparent)
    );
    box-shadow:
      0 0 0 1px color-mix(in srgb, ${AX.border} 60%, transparent),
      0 24px 80px color-mix(in srgb, ${AX.bg} 30%, black),
      0 0 120px color-mix(in srgb, ${accentSoft} 8%, transparent);
  }

  .card-inner {
    border-radius: 18px;
    background: color-mix(in srgb, ${AX.surface} 92%, transparent);
    backdrop-filter: blur(20px);
    padding: 28px 28px 24px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 28px;
  }

  .brand-mark {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, ${AX.elevated} 90%, transparent);
    border: 1px solid color-mix(in srgb, ${AX.border} 80%, transparent);
    box-shadow: 0 0 28px color-mix(in srgb, ${AX.cyan} 18%, transparent);
  }

  .brand-logo {
    width: 32px;
    height: 32px;
    object-fit: contain;
    display: block;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .brand-name {
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    background: linear-gradient(90deg, ${AX.text}, ${AX.cyan});
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .brand-sub {
    font-size: 0.68rem;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${AX.textDim};
  }

  .status-block {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    margin-bottom: 24px;
  }

  .status-icon-wrap {
    position: relative;
    width: 88px;
    height: 88px;
    margin-bottom: 20px;
  }

  .pulse-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 1px solid color-mix(in srgb, ${accent} 40%, transparent);
    animation: pulse-ring 2s ease-out infinite;
  }

  .pulse-ring:nth-child(2) { animation-delay: 0.6s; }

  @keyframes pulse-ring {
    0% { transform: scale(0.75); opacity: 0.8; }
    100% { transform: scale(1.35); opacity: 0; }
  }

  .status-icon {
    position: absolute;
    inset: 12px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, ${accent} 12%, ${AX.elevated});
    border: 1px solid color-mix(in srgb, ${accent} 45%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, ${AX.text} 8%, transparent);
    animation: icon-pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.15s both;
  }

  ${success ? '' : '.status-icon { animation: icon-shake 0.45s ease 0.15s both; }'}

  @keyframes icon-pop {
    from { transform: scale(0.5); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  @keyframes icon-shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-4px); }
    40%, 80% { transform: translateX(4px); }
  }

  .status-icon svg {
    width: 36px;
    height: 36px;
    color: ${accent};
    filter: drop-shadow(0 0 12px color-mix(in srgb, ${accent} 50%, transparent));
  }

  .status-title {
    font-size: 1.35rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0 0 6px;
    color: ${AX.text};
  }

  .status-subtitle {
    font-size: 0.875rem;
    line-height: 1.5;
    color: ${AX.textSecondary};
    margin: 0;
    max-width: 320px;
  }

  .provider-badge {
    display: inline-block;
    margin-top: 14px;
    padding: 5px 14px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    background: color-mix(in srgb, ${AX.cyan} 12%, transparent);
    border: 1px solid color-mix(in srgb, ${AX.cyan} 30%, transparent);
    color: ${AX.cyan};
  }

  .message-panel {
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 16px;
    background: color-mix(in srgb, ${AX.elevated} 80%, transparent);
    border: 1px solid ${AX.border};
  }

  .message-label {
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${AX.textDim};
    margin-bottom: 6px;
  }

  .message-text {
    font-size: 0.875rem;
    line-height: 1.55;
    color: ${AX.textSecondary};
    margin: 0;
  }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 10px;
    margin-bottom: 16px;
    background: color-mix(in srgb, ${AX.bg} 50%, transparent);
    border: 1px dashed color-mix(in srgb, ${AX.border} 80%, transparent);
  }

  .meta-label {
    font-size: 0.72rem;
    font-weight: 500;
    color: ${AX.textDim};
    letter-spacing: 0.04em;
  }

  .meta-value {
    font-family: ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace;
    font-size: 0.75rem;
    color: ${AX.blue};
  }

  .footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 4px;
  }

  .footer-icon {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, ${AX.purple} 10%, transparent);
    border: 1px solid color-mix(in srgb, ${AX.purple} 25%, transparent);
  }

  .footer-icon svg { width: 14px; height: 14px; color: ${AX.purple}; }

  .footer-text {
    flex: 1;
    font-size: 0.78rem;
    line-height: 1.45;
    color: ${AX.textDim};
  }

  .close-btn {
    margin-top: 20px;
    width: 100%;
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, ${AX.cyan} 35%, transparent);
    background: color-mix(in srgb, ${AX.cyan} 10%, transparent);
    color: ${AX.text};
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .close-btn:hover {
    background: color-mix(in srgb, ${AX.cyan} 18%, transparent);
    border-color: color-mix(in srgb, ${AX.cyan} 55%, transparent);
  }

  .close-btn:active { transform: scale(0.98); }

  .secure-line {
    text-align: center;
    margin-top: 20px;
    font-size: 0.68rem;
    color: ${AX.textDim};
    letter-spacing: 0.04em;
  }

  .secure-line span {
    color: color-mix(in srgb, ${AX.green} 80%, ${AX.textDim});
  }
</style>
</head>
<body>
<div class="backdrop">
  <div class="aurora"></div>
  <div class="grid"></div>
  <div class="scanline"></div>
</div>

<div class="shell">
  <div class="card">
    <div class="card-inner">
      <div class="brand">
        <div class="brand-mark">
          <img class="brand-logo" src="/logo.png" alt="Agent-X" width="32" height="32" />
        </div>
        <div class="brand-text">
          <span class="brand-name">AGENT-X</span>
          <span class="brand-sub">Integration Gateway</span>
        </div>
      </div>

      <div class="status-block">
        <div class="status-icon-wrap">
          ${success ? '<div class="pulse-ring"></div><div class="pulse-ring"></div>' : ''}
          <div class="status-icon">
            ${success
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'}
          </div>
        </div>
        <h1 class="status-title">${escapeHtml(statusTitle)}</h1>
        <p class="status-subtitle">${escapeHtml(statusSubtitle)}</p>
        ${providerBadge}
      </div>

      <div class="message-panel">
        <div class="message-label">Details</div>
        <p class="message-text">${escapeHtml(message)}</p>
      </div>

      ${connectionMeta}

      <div class="footer">
        <div class="footer-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div class="footer-text">
          ${escapeHtml(footerHint)}
        </div>
      </div>

      <button type="button" class="close-btn" id="close-btn">${success ? 'Close this tab' : 'Close and return to Agent-X'}</button>
    </div>
  </div>

  <p class="secure-line"><span>AES-256-GCM</span> encrypted credential storage · Agent-X secure mesh</p>
</div>

<script>
(function () {
  var payload = ${payload};

  function notifyAgentX() {
    try { window.opener && window.opener.postMessage(payload, '*'); } catch (e) { /* ignore */ }
    try { new BroadcastChannel('agentx-integrations').postMessage(payload); } catch (e) { /* ignore */ }
  }

  function tryCloseTab() {
    notifyAgentX();
    try { window.close(); } catch (e) { /* ignore */ }
    setTimeout(function () {
      try { window.close(); } catch (e) { /* ignore */ }
    }, 120);
  }

  notifyAgentX();

  var btn = document.getElementById('close-btn');
  if (btn) btn.addEventListener('click', tryCloseTab);

  if (payload.success) {
    tryCloseTab();
  }
})();
</script>
</body>
</html>`;
}
