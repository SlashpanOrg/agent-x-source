/**
 * WhatsApp Contact Tools (Phase 6.4).
 *
 * Tools for checking numbers, blocking/unblocking contacts, and retrieving
 * contact information. Some of these (list contacts, get profile picture)
 * require engine capabilities that may not be available on all engines.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { requireEngine, runTool, requireString } from './helpers.js';

// ─── WhatsAppCheckNumber ─────────────────────────────────────────────────

export async function whatsappCheckNumber(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('check number', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const phoneNumber = requireString(args, 'phoneNumber');
    if (typeof phoneNumber !== "string") return phoneNumber;

    const result = await resolved.engine.checkNumberExists(phoneNumber);

    return {
      success: true,
      output: result.exists
        ? `Number ${phoneNumber} is registered on WhatsApp. JID: ${result.jid ?? 'unknown'}`
        : `Number ${phoneNumber} is NOT registered on WhatsApp.`,
      metadata: { phoneNumber, exists: result.exists, jid: result.jid },
    };
  });
}

// ─── WhatsAppBlockContact ────────────────────────────────────────────────

export async function whatsappBlockContact(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('block contact', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const jid = requireString(args, 'jid');
    if (typeof jid !== "string") return jid;

    await resolved.engine.blockContact(jid);

    return {
      success: true,
      output: `Contact ${jid} has been blocked.`,
      metadata: { jid, action: 'block' },
    };
  });
}

// ─── WhatsAppUnblockContact ──────────────────────────────────────────────

export async function whatsappUnblockContact(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('unblock contact', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const jid = requireString(args, 'jid');
    if (typeof jid !== "string") return jid;

    await resolved.engine.unblockContact(jid);

    return {
      success: true,
      output: `Contact ${jid} has been unblocked.`,
      metadata: { jid, action: 'unblock' },
    };
  });
}

// ─── WhatsAppListContacts ────────────────────────────────────────────────

export async function whatsappListContacts(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('list contacts', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    if (!resolved.engine.listContacts) {
      return {
        success: false,
        output: 'This WhatsApp engine does not support listing contacts. Use WhatsAppCheckNumber to verify a specific number.',
        error: 'NOT_SUPPORTED',
      };
    }

    const limit = typeof args['limit'] === 'number' ? Math.min(args['limit'], 200) : 50;
    const search = typeof args['search'] === 'string' ? args['search'] : undefined;

    const contacts = await resolved.engine.listContacts({ limit, search });

    if (contacts.length === 0) {
      return {
        success: true,
        output: search
          ? `No contacts found matching "${search}".`
          : 'No contacts available. Contacts are loaded from your WhatsApp account — try sending a message first so the contact appears in the store.',
        metadata: { count: 0 },
      };
    }

    const lines = contacts.map((c) => {
      const name = c.name ?? c.notify ?? c.phoneNumber ?? c.jid;
      return `• ${name}${c.phoneNumber ? ` (${c.phoneNumber})` : ''} — JID: ${c.jid}`;
    });

    return {
      success: true,
      output: `Found ${contacts.length} contact${contacts.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
      metadata: { count: contacts.length, contacts },
    };
  });
}

// ─── WhatsAppGetContact ──────────────────────────────────────────────────

export async function whatsappGetContact(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('get contact', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const jid = requireString(args, 'jid');
    if (typeof jid !== "string") return jid;

    if (!resolved.engine.listContacts) {
      return {
        success: false,
        output: 'This WhatsApp engine does not support contact lookup. Use WhatsAppCheckNumber to verify a number.',
        error: 'NOT_SUPPORTED',
      };
    }

    // Use listContacts with a search filter to find the contact by JID.
    const contacts = await resolved.engine.listContacts({ limit: 500 });
    const contact = contacts.find((c) => c.jid === jid);

    if (!contact) {
      return {
        success: false,
        output: `No contact found with JID ${jid}. The contact may not be in the local store — try WhatsAppCheckNumber to verify the number.`,
        error: 'NOT_FOUND',
      };
    }

    return {
      success: true,
      output: `Contact: ${contact.name ?? contact.notify ?? 'Unknown'}\nJID: ${contact.jid}\nPhone: ${contact.phoneNumber ?? 'N/A'}${contact.status ? `\nStatus: ${contact.status}` : ''}`,
      metadata: { ...contact },
    };
  });
}

// ─── WhatsAppGetProfilePicture ───────────────────────────────────────────

export async function whatsappGetProfilePicture(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('get profile picture', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const jid = requireString(args, 'jid');
    if (typeof jid !== "string") return jid;

    return {
      success: false,
      output: 'Getting profile pictures is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}
