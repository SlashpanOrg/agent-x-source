/**
 * WhatsApp Label Tools (Phase 6.6).
 *
 * Labels are a WhatsApp Business API feature. Neither engine adapter currently
 * implements label methods, so the 'labels' capability gate in
 * `requireEngineWithCapability('labels')` returns CAPABILITY_NOT_SUPPORTED
 * on every engine. The capability matrix lists no engines for 'labels'.
 *
 * If a future engine adds label support (by implementing the optional
 * IWhatsAppEngine label methods and returning true from supportsCapability),
 * these tool bodies would call them. Until then, every label tool returns
 * a clear "not supported" error before reaching the body.
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

    // If we reach here, the engine claims labels support but the interface
    // doesn't yet define label methods. Surface a clear, honest message.
    return {
      success: false,
      output: 'Labels are not supported by the active WhatsApp engine. Labels require a WhatsApp Business account and an engine adapter that implements the label API (neither Baileys nor the wwebjs adapter currently does).',
      error: 'NOT_SUPPORTED',
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
      output: 'Labels are not supported by the active WhatsApp engine. Labels require a WhatsApp Business account and an engine adapter that implements the label API.',
      error: 'NOT_SUPPORTED',
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
      output: 'Labels are not supported by the active WhatsApp engine. Labels require a WhatsApp Business account and an engine adapter that implements the label API.',
      error: 'NOT_SUPPORTED',
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
      output: 'Labels are not supported by the active WhatsApp engine. Labels require a WhatsApp Business account and an engine adapter that implements the label API.',
      error: 'NOT_SUPPORTED',
    };
  });
}
