/**
 * WhatsApp Status/Channel/Call/Profile Tools (Phase 6.7).
 *
 * These tools cover:
 *   - Status stories (text/image) — requires 'statusStories' capability
 *   - Channel subscription/listing — requires 'channels' capability
 *   - Call rejection — requires 'rejectCall' capability
 *   - Profile management (name/status/picture)
 *
 * All are implemented against the Baileys multi-device socket API. Capability
 * gating returns a clear CAPABILITY_NOT_SUPPORTED error if the active engine
 * doesn't support a given feature.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import {
  requireEngine,
  requireEngineWithCapability,
  runTool,
  requireString,
  fileToBase64,
  mimeFromPath,
  resolveFilePath,
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

    if (!resolved.engine.postTextStatus) {
      return { success: false, output: 'This WhatsApp engine does not support posting status stories.', error: 'NOT_SUPPORTED' };
    }

    const result = await resolved.engine.postTextStatus(text);
    return {
      success: true,
      output: `Text status posted. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppPostImageStatus ─────────────────────────────────────────────

export async function whatsappPostImageStatus(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('post image status', async () => {
    const resolved = requireEngineWithCapability('statusStories');
    if ("error" in resolved) return resolved.error;

    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;
    const caption = args['caption'] as string | undefined;

    if (!resolved.engine.postImageStatus) {
      return { success: false, output: 'This WhatsApp engine does not support posting image status stories.', error: 'NOT_SUPPORTED' };
    }

    const resolvedPath = resolveFilePath(filePath, context.scopePath);
    const data = fileToBase64(resolvedPath);
    const mimetype = mimeFromPath(resolvedPath);

    const result = await resolved.engine.postImageStatus({ data, mimetype, caption });
    return {
      success: true,
      output: `Image status posted. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, timestamp: result.timestamp },
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

    if (!resolved.engine.listStatusUpdates) {
      return { success: false, output: 'This WhatsApp engine does not support listing status updates.', error: 'NOT_SUPPORTED' };
    }

    const updates = await resolved.engine.listStatusUpdates();
    if (updates.length === 0) {
      return {
        success: true,
        output: 'No recent status updates tracked. Status updates from your contacts are not persisted by this engine.',
        metadata: { count: 0 },
      };
    }

    const lines = updates.map((u) => `• ${u.jid}${u.timestamp ? ` (at ${new Date(u.timestamp * 1000).toISOString()})` : ''}`);
    return {
      success: true,
      output: `Found ${updates.length} status update${updates.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
      metadata: { count: updates.length, updates },
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

    if (!resolved.engine.subscribeChannel) {
      return { success: false, output: 'This WhatsApp engine does not support subscribing to channels.', error: 'NOT_SUPPORTED' };
    }

    const { jid } = await resolved.engine.subscribeChannel(channelInvite);
    return {
      success: true,
      output: `Subscribed to channel ${jid} via invite code ${channelInvite}.`,
      metadata: { jid, inviteCode: channelInvite },
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

    if (!resolved.engine.listChannels) {
      return { success: false, output: 'This WhatsApp engine does not support listing channels.', error: 'NOT_SUPPORTED' };
    }

    const channels = await resolved.engine.listChannels();
    if (channels.length === 0) {
      return {
        success: true,
        output: 'No subscribed channels tracked. Use WhatsAppSubscribeChannel with an invite code to follow a channel.',
        metadata: { count: 0 },
      };
    }

    const lines = channels.map((c) => `• ${c.name ?? c.jid}${c.subscribers ? ` (${c.subscribers} subscribers)` : ''} — ${c.jid}`);
    return {
      success: true,
      output: `Found ${channels.length} channel${channels.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
      metadata: { count: channels.length, channels },
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

    if (!resolved.engine.setProfileName) {
      return { success: false, output: 'This WhatsApp engine does not support changing the profile name.', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.setProfileName(name);
    return {
      success: true,
      output: `Profile name updated to "${name}".`,
      metadata: { name },
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

    if (!resolved.engine.setProfileStatus) {
      return { success: false, output: 'This WhatsApp engine does not support changing the profile status (about).', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.setProfileStatus(status);
    return {
      success: true,
      output: `Profile status (about) updated to "${status}".`,
      metadata: { status },
    };
  });
}

// ─── WhatsAppSetProfilePicture ───────────────────────────────────────────

export async function whatsappSetProfilePicture(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('set profile picture', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;

    if (!resolved.engine.setProfilePicture) {
      return { success: false, output: 'This WhatsApp engine does not support changing the profile picture.', error: 'NOT_SUPPORTED' };
    }

    const resolvedPath = resolveFilePath(filePath, context.scopePath);
    const data = fileToBase64(resolvedPath);
    const mimetype = mimeFromPath(resolvedPath);

    await resolved.engine.setProfilePicture({ data, mimetype });
    return {
      success: true,
      output: `Profile picture updated from ${filePath}.`,
      metadata: { filePath },
    };
  });
}
