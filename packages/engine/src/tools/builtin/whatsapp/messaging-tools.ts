/**
 * WhatsApp Messaging Tools (Phase 6.2).
 *
 * These tools handle sending and manipulating messages. All require the
 * engine to be READY (the session must be linked and connected).
 *
 * Media-sending tools accept a file path (resolved relative to the agent
 * scope) and read+encode the file as base64 before passing to the engine.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { basename } from 'node:path';
import {
  requireEngine,
  requireEngineWithCapability,
  runTool,
  requireString,
  optionalString,
  optionalNumber,
  optionalBoolean,
  requireStringArray,
  fileToBase64,
  mimeFromPath,
  resolveFilePath,
} from './helpers.js';

// ─── WhatsAppSendText ────────────────────────────────────────────────────

export async function whatsappSendText(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send text', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatIdResult = requireString(args, 'chatId');
    if (typeof chatIdResult !== "string") return chatIdResult;
    const textResult = requireString(args, 'text');
    if (typeof textResult !== "string") return textResult;

    const mentions = args['mentions'] as string[] | undefined;
    const quotedMessageId = optionalString(args, 'quotedMessageId');

    const result = await resolved.engine.sendText(chatIdResult, textResult, {
      mentions,
      quotedMessageId,
    });

    return {
      success: true,
      output: `Message sent to ${chatIdResult}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId: chatIdResult, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppSendImage ───────────────────────────────────────────────────

export async function whatsappSendImage(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send image', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;
    const caption = optionalString(args, 'caption');

    const resolvedPath = resolveFilePath(filePath, context.scopePath);
    const data = fileToBase64(resolvedPath);
    const mimetype = mimeFromPath(resolvedPath);

    const result = await resolved.engine.sendImage(chatId, { data, mimetype, caption });

    return {
      success: true,
      output: `Image sent to ${chatId}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppSendVideo ───────────────────────────────────────────────────

export async function whatsappSendVideo(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send video', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;
    const caption = optionalString(args, 'caption');

    const resolvedPath = resolveFilePath(filePath, context.scopePath);
    const data = fileToBase64(resolvedPath);
    const mimetype = mimeFromPath(resolvedPath);

    const result = await resolved.engine.sendVideo(chatId, { data, mimetype, caption });

    return {
      success: true,
      output: `Video sent to ${chatId}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppSendAudio ───────────────────────────────────────────────────

export async function whatsappSendAudio(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send audio', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;
    const ptt = optionalBoolean(args, 'ptt') ?? false; // voice note vs audio file

    const resolvedPath = resolveFilePath(filePath, context.scopePath);
    const data = fileToBase64(resolvedPath);
    const mimetype = mimeFromPath(resolvedPath);

    const result = await resolved.engine.sendAudio(chatId, { data, mimetype, ptt });

    return {
      success: true,
      output: `Audio${ptt ? ' (voice note)' : ''} sent to ${chatId}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppSendDocument ────────────────────────────────────────────────

export async function whatsappSendDocument(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send document', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;
    const caption = optionalString(args, 'caption');
    const fileName = optionalString(args, 'fileName');

    const resolvedPath = resolveFilePath(filePath, context.scopePath);
    const data = fileToBase64(resolvedPath);
    const mimetype = mimeFromPath(resolvedPath);
    const name = fileName ?? basename(resolvedPath);

    const result = await resolved.engine.sendDocument(chatId, { data, mimetype, fileName: name, caption });

    return {
      success: true,
      output: `Document "${name}" sent to ${chatId}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, fileName: name, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppSendLocation ────────────────────────────────────────────────

export async function whatsappSendLocation(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send location', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const latitude = optionalNumber(args, 'latitude');
    const longitude = optionalNumber(args, 'longitude');
    if (latitude === undefined || longitude === undefined) {
      return { success: false, output: 'Parameters "latitude" and "longitude" are required.', error: 'MISSING_INPUT' };
    }
    const name = optionalString(args, 'name');
    const address = optionalString(args, 'address');

    const result = await resolved.engine.sendLocation(chatId, { latitude, longitude, name, address });

    return {
      success: true,
      output: `Location (${latitude}, ${longitude}) sent to ${chatId}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppSendContact ─────────────────────────────────────────────────

export async function whatsappSendContact(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send contact', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const displayName = requireString(args, 'displayName');
    if (typeof displayName !== "string") return displayName;
    const phone = requireString(args, 'phone');
    if (typeof phone !== "string") return phone;
    const organization = optionalString(args, 'organization');

    const result = await resolved.engine.sendContact(chatId, { displayName, phone, organization });

    return {
      success: true,
      output: `Contact "${displayName}" (${phone}) sent to ${chatId}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppSendPoll ────────────────────────────────────────────────────

export async function whatsappSendPoll(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send poll', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const question = requireString(args, 'question');
    if (typeof question !== "string") return question;
    const optionsResult = requireStringArray(args, 'options');
    if (!Array.isArray(optionsResult)) return optionsResult;
    const selectableCount = optionalNumber(args, 'selectableCount');

    const result = await resolved.engine.sendPoll(chatId, question, optionsResult, { selectableCount });

    return {
      success: true,
      output: `Poll "${question}" with ${optionsResult.length} options sent to ${chatId}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, question, optionsCount: optionsResult.length, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppSendSticker ─────────────────────────────────────────────────

export async function whatsappSendSticker(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send sticker', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const filePath = requireString(args, 'filePath');
    if (typeof filePath !== "string") return filePath;

    const resolvedPath = resolveFilePath(filePath, context.scopePath);
    const data = fileToBase64(resolvedPath);
    const mimetype = mimeFromPath(resolvedPath);

    const result = await resolved.engine.sendSticker(chatId, { data, mimetype });

    return {
      success: true,
      output: `Sticker sent to ${chatId}. Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppReply ───────────────────────────────────────────────────────

export async function whatsappReply(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('reply', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const quotedMessageId = requireString(args, 'quotedMessageId');
    if (typeof quotedMessageId !== "string") return quotedMessageId;
    const text = requireString(args, 'text');
    if (typeof text !== "string") return text;

    const result = await resolved.engine.reply(chatId, quotedMessageId, text);

    return {
      success: true,
      output: `Reply sent to ${chatId} (quoting ${quotedMessageId}). Message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, chatId, quotedMessageId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppForward ─────────────────────────────────────────────────────

export async function whatsappForward(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('forward message', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const sourceChatId = requireString(args, 'sourceChatId');
    if (typeof sourceChatId !== "string") return sourceChatId;
    const messageId = requireString(args, 'messageId');
    if (typeof messageId !== "string") return messageId;

    const result = await resolved.engine.forwardMessage(chatId, sourceChatId, messageId);

    return {
      success: true,
      output: `Message ${messageId} forwarded from ${sourceChatId} to ${chatId}. New message ID: ${result.messageId}`,
      metadata: { messageId: result.messageId, originalMessageId: messageId, chatId, sourceChatId, timestamp: result.timestamp },
    };
  });
}

// ─── WhatsAppReact ───────────────────────────────────────────────────────

export async function whatsappReact(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('react', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const messageId = requireString(args, 'messageId');
    if (typeof messageId !== "string") return messageId;
    const emoji = optionalString(args, 'emoji') ?? null; // null = remove reaction

    await resolved.engine.react(chatId, messageId, emoji);

    return {
      success: true,
      output: emoji
        ? `Reaction "${emoji}" added to message ${messageId} in ${chatId}.`
        : `Reaction removed from message ${messageId} in ${chatId}.`,
      metadata: { chatId, messageId, emoji },
    };
  });
}

// ─── WhatsAppEditMessage ─────────────────────────────────────────────────

export async function whatsappEditMessage(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('edit message', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const messageId = requireString(args, 'messageId');
    if (typeof messageId !== "string") return messageId;
    const newText = requireString(args, 'newText');
    if (typeof newText !== "string") return newText;

    await resolved.engine.editMessage(chatId, messageId, newText);

    return {
      success: true,
      output: `Message ${messageId} in ${chatId} edited.`,
      metadata: { chatId, messageId },
    };
  });
}

// ─── WhatsAppDeleteMessage ───────────────────────────────────────────────

export async function whatsappDeleteMessage(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('delete message', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const messageId = requireString(args, 'messageId');
    if (typeof messageId !== "string") return messageId;
    const forEveryone = optionalBoolean(args, 'forEveryone') ?? false;

    await resolved.engine.deleteMessage(chatId, messageId, forEveryone);

    return {
      success: true,
      output: forEveryone
        ? `Message ${messageId} deleted for everyone in ${chatId}.`
        : `Message ${messageId} deleted for me in ${chatId}.`,
      metadata: { chatId, messageId, forEveryone },
    };
  });
}

// ─── WhatsAppGetMessageHistory ───────────────────────────────────────────
// Requires the 'chatHistoryFetch' capability. Baileys returns messages
// observed since the session connected (full history sync is disabled per §0.7).

export async function whatsappGetMessageHistory(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('get message history', async () => {
    const resolved = requireEngineWithCapability('chatHistoryFetch');
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const limit = optionalNumber(args, 'limit') ?? 50;

    if (!resolved.engine.getMessageHistory) {
      return {
        success: false,
        output: 'This WhatsApp engine does not support fetching message history.',
        error: 'NOT_SUPPORTED',
      };
    }

    const messages = await resolved.engine.getMessageHistory(chatId, limit);

    if (messages.length === 0) {
      return {
        success: true,
        output: `No recent messages found for ${chatId}. Messages are tracked from the moment the session connected — send or receive a message first, or the chat may have no recent activity.`,
        metadata: { chatId, count: 0 },
      };
    }

    const lines = messages.map((m) => {
      const dir = m.fromMe ? 'You' : (m.pushName ?? m.from ?? 'Them');
      const time = new Date(m.timestamp * 1000).toISOString();
      const body = m.body || `[${m.type}]`;
      return `[${time}] ${dir}: ${body}`;
    });

    return {
      success: true,
      output: `Last ${messages.length} message${messages.length === 1 ? '' : 's'} in ${chatId}:\n${lines.join('\n')}`,
      metadata: { chatId, count: messages.length, messages },
    };
  });
}

// ─── WhatsAppGetReactions ────────────────────────────────────────────────

export async function whatsappGetReactions(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('get reactions', async () => {
    const resolved = requireEngineWithCapability('messageReactionsQuery');
    if ("error" in resolved) return resolved.error;

    const chatId = requireString(args, 'chatId');
    if (typeof chatId !== "string") return chatId;
    const messageId = requireString(args, 'messageId');
    if (typeof messageId !== "string") return messageId;

    if (!resolved.engine.getReactions) {
      return {
        success: false,
        output: 'This WhatsApp engine does not support querying reactions.',
        error: 'NOT_SUPPORTED',
      };
    }

    const reactions = await resolved.engine.getReactions(chatId, messageId);

    if (reactions.length === 0) {
      return {
        success: true,
        output: `No reactions recorded for message ${messageId} in ${chatId}. Reactions are tracked from the moment the session connected.`,
        metadata: { chatId, messageId, count: 0 },
      };
    }

    const lines = reactions.map((r) => `${r.senderId}: ${r.emoji ?? '(removed)'}`);
    return {
      success: true,
      output: `Reactions on message ${messageId} (${reactions.length}):\n${lines.join('\n')}`,
      metadata: { chatId, messageId, count: reactions.length, reactions },
    };
  });
}
