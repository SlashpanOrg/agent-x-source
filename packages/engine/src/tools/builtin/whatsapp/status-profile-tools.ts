/**
 * WhatsApp Status/Channel/Call/Profile Tools (Phase 6.7).
 *
 * These tools cover:
 *   - Status stories (text/image) — requires 'statusStories' capability
 *   - Channel subscription/listing — requires 'channels' capability
 *   - Call rejection — requires 'rejectCall' capability
 *   - Profile management (name/status/picture)
 *
 * Most of these are capability-gated. Tools that aren't yet implemented
 * in the engine interface return NOT_IMPLEMENTED with a clear message.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import {
  requireEngine,
  requireEngineWithCapability,
  runTool,
  requireString,
} from './helpers.js';

// ─── WhatsAppPostTextStatus ──────────────────────────────────────────────

export async function whatsappPostTextStatus(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('post text status', async () => {
    const resolved = requireEngineWithCapability('statusStories');
    if ("error" in resolved) return resolved.error;

    const text = requireString(args, 'text');
    if (typeof text !== "string") return text;

    return {
      success: false,
      output: 'Posting text status stories is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppPostImageStatus ─────────────────────────────────────────────

export async function whatsappPostImageStatus(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('post image status', async () => {
    const resolved = requireEngineWithCapability('statusStories');
    if ("error" in resolved) return resolved.error;

    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;

    return {
      success: false,
      output: 'Posting image status stories is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppListStatusUpdates ───────────────────────────────────────────

export async function whatsappListStatusUpdates(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('list status updates', async () => {
    const resolved = requireEngineWithCapability('statusStories');
    if ("error" in resolved) return resolved.error;

    return {
      success: false,
      output: 'Listing status updates is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppSubscribeChannel ────────────────────────────────────────────

export async function whatsappSubscribeChannel(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('subscribe channel', async () => {
    const resolved = requireEngineWithCapability('channels');
    if ("error" in resolved) return resolved.error;

    const channelInvite = requireString(args, 'channelInvite');
    if (typeof channelInvite !== "string") return channelInvite;

    return {
      success: false,
      output: 'Subscribing to channels is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppListChannels ────────────────────────────────────────────────

export async function whatsappListChannels(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('list channels', async () => {
    const resolved = requireEngineWithCapability('channels');
    if ("error" in resolved) return resolved.error;

    return {
      success: false,
      output: 'Listing channels is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppRejectCall ──────────────────────────────────────────────────

export async function whatsappRejectCall(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('reject call', async () => {
    const resolved = requireEngineWithCapability('rejectCall');
    if ("error" in resolved) return resolved.error;

    const callId = requireString(args, 'callId');
    if (typeof callId !== "string") return callId;

    await resolved.engine.rejectCall(callId);

    return {
      success: true,
      output: `Call ${callId} rejected.`,
      metadata: { callId },
    };
  });
}

// ─── WhatsAppSetProfileName ──────────────────────────────────────────────

export async function whatsappSetProfileName(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('set profile name', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const name = requireString(args, 'name');
    if (typeof name !== "string") return name;

    return {
      success: false,
      output: 'Setting profile name is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppSetProfileStatus ────────────────────────────────────────────

export async function whatsappSetProfileStatus(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('set profile status', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const status = requireString(args, 'status');
    if (typeof status !== "string") return status;

    return {
      success: false,
      output: 'Setting profile status (about) is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppSetProfilePicture ───────────────────────────────────────────

export async function whatsappSetProfilePicture(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('set profile picture', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;

    return {
      success: false,
      output: 'Setting profile picture is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}
