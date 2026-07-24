/**
 * WhatsApp Label Tools (Phase 6.6).
 *
 * Labels are a Business-account-only feature. All label tools are guarded
 * with the 'labels' capability check — if the linked account is not a
 * Business account, the tools return a clear "not supported" error rather
 * than letting the underlying library throw an opaque exception.
 *
 * Note: The IWhatsAppEngine interface doesn't currently have label methods.
 * These tools are defined with correct schemas and capability gating, but
 * return NOT_IMPLEMENTED until the engine interface is extended.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { requireEngineWithCapability, runTool, requireString } from './helpers.js';

// ─── WhatsAppListLabels ──────────────────────────────────────────────────

export async function whatsappListLabels(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('list labels', async () => {
    const resolved = requireEngineWithCapability('labels');
    if ("error" in resolved) return resolved.error;

    return {
      success: false,
      output: 'Listing labels is not yet implemented in the engine interface. This capability requires a WhatsApp Business account.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppGetChatLabels ───────────────────────────────────────────────

export async function whatsappGetChatLabels(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('get chat labels', async () => {
    const resolved = requireEngineWithCapability('labels');
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;

    return {
      success: false,
      output: 'Getting chat labels is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppAddLabelToChat ──────────────────────────────────────────────

export async function whatsappAddLabelToChat(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('add label to chat', async () => {
    const resolved = requireEngineWithCapability('labels');
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const labelId = requireString(args, 'labelId');
    if (typeof labelId !== "string") return labelId;

    return {
      success: false,
      output: 'Adding labels to chats is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppRemoveLabelFromChat ─────────────────────────────────────────

export async function whatsappRemoveLabelFromChat(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('remove label from chat', async () => {
    const resolved = requireEngineWithCapability('labels');
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const labelId = requireString(args, 'labelId');
    if (typeof labelId !== "string") return labelId;

    return {
      success: false,
      output: 'Removing labels from chats is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}
