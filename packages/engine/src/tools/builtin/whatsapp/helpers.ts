/**
 * Shared helpers for WhatsApp agent tools (Phase 6).
 *
 * Every WhatsApp tool handler follows the same pattern:
 *   1. Get the WhatsAppSessionService singleton
 *   2. Get the engine from it
 *   3. Check the engine is ready (or return a clear error)
 *   4. Optionally check capabilities
 *   5. Execute the operation
 *   6. Return a ToolResult
 *
 * These helpers centralize steps 1-4 so individual tool files stay focused
 * on the actual operation logic.
 */
import type { ToolResult } from '@agentx/shared';
import { getWhatsAppSessionServiceInstance } from '../../../services/ServiceContext.js';
import type { IWhatsAppEngine } from '../../../whatsapp/engine/IWhatsAppEngine.js';
import { EngineStatus } from '../../../whatsapp/engine/IWhatsAppEngine.js';
import type { EngineCapability } from '../../../whatsapp/engine/IWhatsAppEngine.js';
import type { WhatsAppSessionService } from '../../../whatsapp/WhatsAppSessionService.js';

/**
 * The paused message shown to the agent and the user when WhatsApp is
 * soft-paused due to a protocol break or version upgrade.
 */
const PAUSED_MESSAGE =
  'WhatsApp is temporarily disabled due to a WhatsApp protocol update. ' +
  'This will be resolved in the next Agent-X update (usually within 48 hours). ' +
  'No action is needed from you — WhatsApp will reconnect automatically once the update is installed.';

/**
 * Check if WhatsApp is soft-paused at runtime. The session service sets its
 * `paused` flag automatically when the engine fails to connect (protocol
 * break, library incompatibility, etc.). The user can retry via the UI.
 */
function isWhatsAppPaused(): boolean {
  const sessionService = getWhatsAppSessionServiceInstance();
  if (sessionService) {
    return sessionService.paused;
  }
  return false;
}

/**
 * The standard "paused" ToolResult returned by all WhatsApp tools when
 * WhatsApp is soft-paused.
 */
export const PAUSED_RESULT: ToolResult = {
  success: false,
  output: PAUSED_MESSAGE,
  error: 'WHATSAPP_PAUSED',
};

/** Result of resolving the active WhatsApp engine. */
export interface EngineResolution {
  sessionService: WhatsAppSessionService;
  engine: IWhatsAppEngine;
}

/**
 * Get the active WhatsApp session service and engine.
 * Returns an error ToolResult if WhatsApp is not linked or not ready.
 */
export function requireEngine(): EngineResolution | { error: ToolResult } {
  // Soft-pause check: if WhatsApp is paused, all tools return immediately
  if (isWhatsAppPaused()) {
    return { error: PAUSED_RESULT };
  }

  const sessionService = getWhatsAppSessionServiceInstance();
  if (!sessionService) {
    return {
      error: {
        success: false,
        output: 'WhatsApp is not configured. Link a number first using the WhatsAppLinkSession tool or Settings → Channels.',
        error: 'WHATSAPP_NOT_CONFIGURED',
      },
    };
  }

  const engine = sessionService.getEngine();
  if (!engine) {
    return {
      error: {
        success: false,
        output: 'WhatsApp session is not linked. Use WhatsAppLinkSession to start the linking flow.',
        error: 'WHATSAPP_NOT_LINKED',
      },
    };
  }

  if (engine.getStatus() !== EngineStatus.READY) {
    return {
      error: {
        success: false,
        output: `WhatsApp session is not ready (current status: ${engine.getStatus()}). Wait for the session to connect or use WhatsAppLinkSession to start linking.`,
        error: 'WHATSAPP_NOT_READY',
      },
    };
  }

  return { sessionService, engine };
}

/**
 * Require the engine AND a specific capability.
 * Returns a clear "not supported" error if the engine doesn't support the capability.
 */
export function requireEngineWithCapability(capability: EngineCapability): EngineResolution | { error: ToolResult } {
  const resolved = requireEngine();
  if ('error' in resolved) return resolved;

  if (!resolved.engine.supportsCapability(capability)) {
    return {
      error: {
        success: false,
        output: `This operation requires the "${capability}" capability, which is not supported by the current WhatsApp engine (${resolved.engine.name}). This typically means the linked account is not a Business account or the engine doesn't implement this feature.`,
        error: 'CAPABILITY_NOT_SUPPORTED',
      },
    };
  }

  return resolved;
}

/**
 * Get the session service without requiring the engine to be ready.
 * Used by session-management tools (link, status, stop, unlink) that operate
 * on the session lifecycle itself, not on messaging operations.
 */
export function requireSessionService(): WhatsAppSessionService | { error: ToolResult } {
  const sessionService = getWhatsAppSessionServiceInstance();
  if (!sessionService) {
    return {
      error: {
        success: false,
        output: 'WhatsApp is not configured. Enable WhatsApp in Settings → Channels first.',
        error: 'WHATSAPP_NOT_CONFIGURED',
      },
    };
  }
  return sessionService;
}

/** Wrap an async operation in a try/catch and return a ToolResult. */
export async function runTool(
  operation: string,
  fn: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: `WhatsApp ${operation} failed: ${message}`,
      error: 'OPERATION_FAILED',
    };
  }
}

/** Read a file and return base64-encoded content. Used by media-sending tools. */
export function fileToBase64(filePath: string): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const content = readFileSync(filePath);
  return content.toString('base64');
}

/** MIME type lookup from file extension. */
export function mimeFromPath(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  const MIME_MAP: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    '3gp': 'video/3gpp',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    m4a: 'audio/mp4',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
  };
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

/** Resolve a file path relative to the agent scope (same logic as channel-send.ts). */
export function resolveFilePath(filePath: string, scopePath: string): string {
  const { resolve, isAbsolute } = require('node:path') as typeof import('node:path');
  const { isAgentInternalPath } = require('@agentx/shared') as typeof import('@agentx/shared');
  if (isAbsolute(filePath) && isAgentInternalPath(filePath)) {
    return filePath;
  }
  return resolve(scopePath, filePath);
}

/** Extract a required string argument from the tool args. Returns the string or an error ToolResult. */
export function requireString(args: Record<string, unknown>, key: string): string | ToolResult {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    return {
      success: false,
      output: `Parameter "${key}" is required and must be a non-empty string.`,
      error: 'MISSING_INPUT',
    };
  }
  return value;
}

/** Extract an optional string argument. */
export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** Extract an optional number argument. */
export function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && !Number.isNaN(value) ? value : undefined;
}

/** Extract an optional boolean argument. */
export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** Extract a required string array argument. Returns the array or an error ToolResult. */
export function requireStringArray(args: Record<string, unknown>, key: string): string[] | ToolResult {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === 'string')) {
    return {
      success: false,
      output: `Parameter "${key}" is required and must be a non-empty array of strings.`,
      error: 'MISSING_INPUT',
    };
  }
  return value as string[];
}
