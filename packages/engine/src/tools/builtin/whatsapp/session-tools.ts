/**
 * WhatsApp Session Tools (Phase 6.1).
 *
 * These tools manage the WhatsApp session lifecycle — linking, status,
 * stopping, unlinking, and requesting pairing codes. They do NOT require
 * the engine to be READY (they operate on the session service itself).
 *
 * Per Ground Rule 7, there is exactly one session — no sessionId parameter.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { requireSessionService, runTool, requireString } from './helpers.js';

// ─── WhatsAppLinkSession ─────────────────────────────────────────────────

export async function whatsappLinkSession(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('link session', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    const status = await resolved.getStatus();
    if (status.status === 'ready') {
      return {
        success: true,
        output: `WhatsApp session is already linked${status.phoneNumber ? ` (${status.phoneNumber})` : ''}. Use WhatsAppGetSessionStatus for details.`,
      };
    }
    if (status.status === 'initializing' || status.status === 'qr_ready' || status.status === 'pairing') {
      return {
        success: true,
        output: `WhatsApp session is already in progress (status: ${status.status}). Check WhatsAppGetSessionStatus for the QR code or pairing code.`,
      };
    }

    await resolved.link();
    // After link(), check what happened — QR may be available
    const newStatus = await resolved.getStatus();
    if (newStatus.status === 'qr_ready') {
      const qr = resolved.getEngine()?.getQr();
      return {
        success: true,
        output: qr
          ? `WhatsApp linking started. Scan the QR code (available as a data URL in metadata) to link your number. Alternatively, use WhatsAppRequestPairingCode with your phone number for a pairing code.`
          : `WhatsApp linking started. Check WhatsAppGetSessionStatus for the QR code.`,
        metadata: { qrDataUrl: qr, status: newStatus.status },
      };
    }
    return {
      success: true,
      output: `WhatsApp linking started (status: ${newStatus.status}). Check WhatsAppGetSessionStatus for updates.`,
      metadata: { status: newStatus.status },
    };
  });
}

// ─── WhatsAppGetSessionStatus ────────────────────────────────────────────

export async function whatsappGetSessionStatus(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('get session status', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    const status = await resolved.getStatus();
    const engine = resolved.getEngine();
    const qr = engine?.getQr();

    const lines = [
      `WhatsApp Session Status:`,
      `  Engine: ${status.engine}`,
      `  Status: ${status.status}`,
    ];
    if (status.phoneNumber) lines.push(`  Phone: ${status.phoneNumber}`);
    if (status.pushName) lines.push(`  Name: ${status.pushName}`);
    if (status.connectedAt) lines.push(`  Connected: ${status.connectedAt.toISOString()}`);
    if (status.lastActiveAt) lines.push(`  Last active: ${status.lastActiveAt.toISOString()}`);
    if (status.lastError) lines.push(`  Last error: ${status.lastError}`);
    if (qr) lines.push(`  QR: available (scan to link)`);

    return {
      success: true,
      output: lines.join('\n'),
      metadata: {
        engine: status.engine,
        status: status.status,
        phoneNumber: status.phoneNumber,
        pushName: status.pushName,
        connectedAt: status.connectedAt?.toISOString(),
        lastActiveAt: status.lastActiveAt?.toISOString(),
        lastError: status.lastError,
        qrDataUrl: qr,
      },
    };
  });
}

// ─── WhatsAppStopSession ─────────────────────────────────────────────────

export async function whatsappStopSession(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('stop session', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    await resolved.stop();
    return {
      success: true,
      output: 'WhatsApp socket stopped. The link is still saved (like closing WhatsApp Web). WhatsAppLinkSession reconnects without a new QR. Use WhatsAppUnlinkSession only to remove the device.',
    };
  });
}

// ─── WhatsAppUnlinkSession ───────────────────────────────────────────────

export async function whatsappUnlinkSession(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('unlink session', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    await resolved.unlink();
    return {
      success: true,
      output: 'WhatsApp session unlinked. All stored credentials have been purged. Use WhatsAppLinkSession to link a new number.',
    };
  });
}

// ─── WhatsAppRequestPairingCode ──────────────────────────────────────────

export async function whatsappRequestPairingCode(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('request pairing code', async () => {
    const phoneNumberResult = requireString(args, 'phoneNumber');
    if (typeof phoneNumberResult !== "string") return phoneNumberResult;
    const phoneNumber = phoneNumberResult;

    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    // The session must be in the linking flow (INITIALIZING or QR_READY)
    const status = await resolved.getStatus();
    if (status.status === 'ready') {
      return {
        success: false,
        output: 'WhatsApp session is already linked. Unlink first if you want to link a different number.',
        error: 'ALREADY_LINKED',
      };
    }

    const code = await resolved.requestPairingCode(phoneNumber);
    return {
      success: true,
      output: `Pairing code generated: ${code}. Enter this code on your WhatsApp phone app → Settings → Linked Devices → Link a Device.`,
      metadata: { pairingCode: code },
    };
  });
}

