/** Shared OAuth popup handle — closed when integration OAuth succeeds. */
let oauthPopup: Window | null = null;

export async function openIntegrationOAuthUrl(authUrl: string): Promise<void> {
  const desktop = typeof window !== 'undefined' ? window.agentx : undefined;
  if (desktop?.openExternal) {
    oauthPopup = null;
    await desktop.openExternal(authUrl);
    return;
  }
  // Named window without noopener so we can close it after callback (best-effort).
  oauthPopup = window.open(authUrl, 'agentx_oauth');
}

export function closeIntegrationOAuthWindow(): void {
  try {
    if (oauthPopup && !oauthPopup.closed) oauthPopup.close();
  } catch {
    /* ignore — external browser tabs cannot be closed from the app */
  }
  oauthPopup = null;
}
