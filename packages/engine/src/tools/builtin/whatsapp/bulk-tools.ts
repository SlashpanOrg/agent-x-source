/**
 * WhatsApp Bulk Send-Safety Tools (Phase 6.3).
 *
 * These tools allow the agent to send messages in bulk while respecting
 * the conservative rate limiter from Phase 5.5. The bulk sender does NOT
 * bypass the rate limiter — it batches through it sequentially with
 * appropriate delays.
 *
 * Batches are tracked in-memory (a Map) so the agent can check status
 * and cancel ongoing batches. For v1, batches are not persisted to the
 * database — if the agent restarts, in-flight batches are lost (the
 * individual messages that were already sent remain sent).
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { requireEngine, runTool, requireStringArray, optionalNumber, optionalString } from './helpers.js';

// ─── In-memory batch tracking ────────────────────────────────────────────

interface BulkBatch {
  id: string;
  chatId: string;
  total: number;
  sent: number;
  failed: number;
  errors: string[];
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  cancelled: boolean;
}

const batches = new Map<string, BulkBatch>();

// ─── WhatsAppSendBulk ────────────────────────────────────────────────────

export async function whatsappSendBulk(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('send bulk', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const chatId = optionalString(args, 'chatId');
    const messagesResult = requireStringArray(args, 'messages');
    if (!Array.isArray(messagesResult)) return messagesResult;
    const messages = messagesResult;

    // If chatId is provided, all messages go to that chat.
    // If not, each message must be an object with chatId + text (but since
    // we get string[], we require chatId at the top level for v1).
    if (!chatId) {
      return {
        success: false,
        output: 'Parameter "chatId" is required for bulk send (all messages go to the same chat).',
        error: 'MISSING_INPUT',
      };
    }

    const delayMs = optionalNumber(args, 'delayMs') ?? 2000; // conservative default
    const batchId = `bulk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const batch: BulkBatch = {
      id: batchId,
      chatId,
      total: messages.length,
      sent: 0,
      failed: 0,
      errors: [],
      status: 'running',
      startedAt: new Date(),
      cancelled: false,
    };
    batches.set(batchId, batch);

    // Fire and forget — the batch runs in the background
    void runBulkBatch(batch, messages, delayMs, resolved.engine.sendText.bind(resolved.engine));

    return {
      success: true,
      output: `Bulk send started: ${messages.length} messages to ${chatId}. Batch ID: ${batchId}. Use WhatsAppGetBatchStatus to check progress.`,
      metadata: { batchId, total: messages.length, chatId },
    };
  });
}

async function runBulkBatch(
  batch: BulkBatch,
  messages: string[],
  delayMs: number,
  sendFn: (chatId: string, text: string) => Promise<{ messageId: string; timestamp: number }>,
): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    if (batch.cancelled) {
      batch.status = 'cancelled';
      batch.completedAt = new Date();
      return;
    }

    try {
      await sendFn(batch.chatId, messages[i]!);
      batch.sent++;
    } catch (error) {
      batch.failed++;
      batch.errors.push(`Message ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Delay between sends (except after the last one)
    if (i < messages.length - 1 && !batch.cancelled) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  batch.status = batch.failed > 0 && batch.sent === 0 ? 'failed' : 'completed';
  batch.completedAt = new Date();
}

// ─── WhatsAppGetBatchStatus ──────────────────────────────────────────────

export async function whatsappGetBatchStatus(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('get batch status', async () => {
    const batchId = optionalString(args, 'batchId');
    if (!batchId) {
      return { success: false, output: 'Parameter "batchId" is required.', error: 'MISSING_INPUT' };
    }

    const batch = batches.get(batchId);
    if (!batch) {
      return { success: false, output: `Batch ${batchId} not found.`, error: 'NOT_FOUND' };
    }

    const lines = [
      `Batch ${batch.id}:`,
      `  Status: ${batch.status}`,
      `  Chat: ${batch.chatId}`,
      `  Progress: ${batch.sent}/${batch.total} sent, ${batch.failed} failed`,
      `  Started: ${batch.startedAt.toISOString()}`,
    ];
    if (batch.completedAt) lines.push(`  Completed: ${batch.completedAt.toISOString()}`);
    if (batch.errors.length > 0) {
      lines.push(`  Errors (${Math.min(batch.errors.length, 5)} shown):`);
      for (const err of batch.errors.slice(0, 5)) lines.push(`    - ${err}`);
    }

    return {
      success: true,
      output: lines.join('\n'),
      metadata: {
        batchId: batch.id,
        status: batch.status,
        chatId: batch.chatId,
        total: batch.total,
        sent: batch.sent,
        failed: batch.failed,
        startedAt: batch.startedAt.toISOString(),
        completedAt: batch.completedAt?.toISOString(),
      },
    };
  });
}

// ─── WhatsAppCancelBatch ─────────────────────────────────────────────────

export async function whatsappCancelBatch(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('cancel batch', async () => {
    const batchId = optionalString(args, 'batchId');
    if (!batchId) {
      return { success: false, output: 'Parameter "batchId" is required.', error: 'MISSING_INPUT' };
    }

    const batch = batches.get(batchId);
    if (!batch) {
      return { success: false, output: `Batch ${batchId} not found.`, error: 'NOT_FOUND' };
    }

    if (batch.status === 'completed' || batch.status === 'cancelled' || batch.status === 'failed') {
      return {
        success: true,
        output: `Batch ${batchId} is already ${batch.status}. No action taken.`,
      };
    }

    batch.cancelled = true;
    return {
      success: true,
      output: `Batch ${batchId} cancellation requested. ${batch.sent} messages were already sent and cannot be unsent. The batch will stop after the current message.`,
      metadata: { batchId, sent: batch.sent, total: batch.total },
    };
  });
}
