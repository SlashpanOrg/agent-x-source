/**
 * WhatsApp Webhook Management Tools (Phase 6.8).
 *
 * These tools manage external webhook subscriptions — third-party endpoints
 * that receive WhatsApp events (e.g. for n8n, CRM integration, custom
 * backends). This is NOT how the agent itself learns about inbound messages
 * (that's the in-process WhatsAppEventBus → IChannelBridge path from Phase 5).
 *
 * Webhooks are stored in the `whatsapp_webhooks` table (V023 migration).
 * The secret is encrypted at rest using the same DEK as the session credentials.
 *
 * Per Ground Rule 10, webhook management is exclusively through these tools —
 * no separate REST CRUD routes.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { randomUUID } from 'node:crypto';
import { requireSessionService, runTool, requireString, optionalString, optionalNumber } from './helpers.js';
import { getWhatsAppSessionServiceInstance } from '../../../services/ServiceContext.js';

// ─── Encryption helper (reuse the same DEK-based encryption from WhatsAppStore) ─

interface EncryptedSecret {
  enc: string;
  iv: string;
  tag: string;
}

function encryptSecret(plaintext: string, dek: Buffer): EncryptedSecret {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { enc: enc.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64') };
}

function getDek(): Buffer | null {
  const svc = getWhatsAppSessionServiceInstance();
  if (!svc) return null;
  // Access the DEK from the session service — it's stored privately but
  // we can access it via a typed cast since this is the same package
  return (svc as unknown as { dek: Buffer }).dek;
}

// ─── WhatsAppCreateWebhook ───────────────────────────────────────────────

export async function whatsappCreateWebhook(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('create webhook', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    const url = requireString(args, 'url');
    if (typeof url !== "string") return url;
    const secret = optionalString(args, 'secret');
    const events = args['events'] as string[] | undefined;
    const retryCount = optionalNumber(args, 'retryCount') ?? 3;

    // Basic URL validation
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { success: false, output: 'Webhook URL must use http or https protocol.', error: 'INVALID_URL' };
      }
    } catch {
      return { success: false, output: `Invalid URL: ${url}`, error: 'INVALID_URL' };
    }

    const id = randomUUID();
    const dek = getDek();

    // Get the pool from the session service
    const pool = (resolved as unknown as { pool: import('pg').Pool }).pool;

    let secretEnc: string | null = null;
    let secretIv: string | null = null;
    let secretTag: string | null = null;

    if (secret && dek) {
      const enc = encryptSecret(secret, dek);
      secretEnc = enc.enc;
      secretIv = enc.iv;
      secretTag = enc.tag;
    }

    await pool.query(
      `INSERT INTO whatsapp_webhooks (id, url, events, secret_enc, secret_iv, secret_tag, retry_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        url,
        events ?? ['*'],
        secretEnc,
        secretIv,
        secretTag,
        retryCount,
      ],
    );

    return {
      success: true,
      output: `Webhook created. ID: ${id}. URL: ${url}. Events: ${(events ?? ['*']).join(', ')}.`,
      metadata: { webhookId: id, url, events: events ?? ['*'], retryCount },
    };
  });
}

// ─── WhatsAppListWebhooks ────────────────────────────────────────────────

export async function whatsappListWebhooks(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('list webhooks', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    const pool = (resolved as unknown as { pool: import('pg').Pool }).pool;
    const result = await pool.query(
      `SELECT id, url, events, active, retry_count, last_triggered_at, created_at
       FROM whatsapp_webhooks ORDER BY created_at DESC`,
    );

    if (result.rows.length === 0) {
      return { success: true, output: 'No webhooks configured.' };
    }

    const lines = ['WhatsApp Webhooks:'];
    for (const row of result.rows) {
      lines.push(`  ID: ${row.id}`);
      lines.push(`    URL: ${row.url}`);
      lines.push(`    Events: ${(row.events as string[]).join(', ')}`);
      lines.push(`    Active: ${row.active}`);
      lines.push(`    Retry count: ${row.retry_count}`);
      if (row.last_triggered_at) lines.push(`    Last triggered: ${row.last_triggered_at}`);
      lines.push('');
    }

    return {
      success: true,
      output: lines.join('\n'),
      metadata: { count: result.rows.length, webhooks: result.rows },
    };
  });
}

// ─── WhatsAppUpdateWebhook ───────────────────────────────────────────────

export async function whatsappUpdateWebhook(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('update webhook', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    const webhookId = requireString(args, 'webhookId');
    if (typeof webhookId !== "string") return webhookId;
    const url = optionalString(args, 'url');
    const events = args['events'] as string[] | undefined;
    const active = args['active'] as boolean | undefined;
    const retryCount = optionalNumber(args, 'retryCount');
    const secret = optionalString(args, 'secret');

    const pool = (resolved as unknown as { pool: import('pg').Pool }).pool;

    // Build dynamic UPDATE
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (url) {
      updates.push(`url = $${paramIdx++}`);
      values.push(url);
    }
    if (events) {
      updates.push(`events = $${paramIdx++}`);
      values.push(events);
    }
    if (typeof active === 'boolean') {
      updates.push(`active = $${paramIdx++}`);
      values.push(active);
    }
    if (retryCount !== undefined) {
      updates.push(`retry_count = $${paramIdx++}`);
      values.push(retryCount);
    }
    if (secret) {
      const dek = getDek();
      if (dek) {
        const enc = encryptSecret(secret, dek);
        updates.push(`secret_enc = $${paramIdx++}`);
        values.push(enc.enc);
        updates.push(`secret_iv = $${paramIdx++}`);
        values.push(enc.iv);
        updates.push(`secret_tag = $${paramIdx++}`);
        values.push(enc.tag);
      }
    }
    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) {
      return { success: false, output: 'No fields to update.', error: 'MISSING_INPUT' };
    }

    values.push(webhookId);
    const result = await pool.query(
      `UPDATE whatsapp_webhooks SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
      values,
    );

    if (result.rowCount === 0) {
      return { success: false, output: `Webhook ${webhookId} not found.`, error: 'NOT_FOUND' };
    }

    return {
      success: true,
      output: `Webhook ${webhookId} updated.`,
      metadata: { webhookId },
    };
  });
}

// ─── WhatsAppDeleteWebhook ───────────────────────────────────────────────

export async function whatsappDeleteWebhook(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('delete webhook', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    const webhookId = requireString(args, 'webhookId');
    if (typeof webhookId !== "string") return webhookId;

    const pool = (resolved as unknown as { pool: import('pg').Pool }).pool;
    const result = await pool.query('DELETE FROM whatsapp_webhooks WHERE id = $1', [webhookId]);

    if (result.rowCount === 0) {
      return { success: false, output: `Webhook ${webhookId} not found.`, error: 'NOT_FOUND' };
    }

    return {
      success: true,
      output: `Webhook ${webhookId} deleted.`,
      metadata: { webhookId },
    };
  });
}

// ─── WhatsAppTestWebhook ─────────────────────────────────────────────────

export async function whatsappTestWebhook(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('test webhook', async () => {
    const resolved = requireSessionService();
    if ("error" in resolved) return resolved.error;

    const webhookId = requireString(args, 'webhookId');
    if (typeof webhookId !== "string") return webhookId;

    const pool = (resolved as unknown as { pool: import('pg').Pool }).pool;
    const result = await pool.query('SELECT url FROM whatsapp_webhooks WHERE id = $1', [webhookId]);

    if (result.rows.length === 0) {
      return { success: false, output: `Webhook ${webhookId} not found.`, error: 'NOT_FOUND' };
    }

    const url = result.rows[0]!.url as string;

    // Send a test event to the webhook URL
    const testPayload = {
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      webhookId,
      message: 'This is a test event from Agent-X WhatsApp integration.',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        return {
          success: true,
          output: `Test event sent to ${url}. Response: ${response.status} ${response.statusText}.`,
          metadata: { webhookId, statusCode: response.status },
        };
      }
      return {
        success: false,
        output: `Test event sent to ${url} but received non-OK response: ${response.status} ${response.statusText}.`,
        error: 'WEBHOOK_TEST_FAILED',
        metadata: { webhookId, statusCode: response.status },
      };
    } catch (error) {
      return {
        success: false,
        output: `Failed to send test event to ${url}: ${error instanceof Error ? error.message : String(error)}`,
        error: 'WEBHOOK_TEST_FAILED',
      };
    }
  });
}
