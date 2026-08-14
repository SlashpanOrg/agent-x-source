/**
 * WhatsApp Contact Tools (Phase 6.4) + owner address-book resolution.
 *
 * The contact directory is a structured index (not RAG). Resolution is
 * unique-match or ask — never a fuzzy guess.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { getContactDirectoryStoreInstance } from '../../../services/ServiceContext.js';
import { formatContactLine, formatResolveForTool } from '../../../whatsapp/contacts/formatContact.js';
import { contactDisplayName } from '../../../whatsapp/contacts/normalize.js';
import { requireEngine, runTool, requireString, requireResolvedChatId, optionalString } from './helpers.js';

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
    if (result.exists && result.jid) {
      const directory = getContactDirectoryStoreInstance();
      void directory?.upsertFromEngine([{
        jid: result.jid,
        phoneNumber: phoneNumber.replace(/\D/g, ''),
      }]);
    }

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

    const jid = requireResolvedChatId(args, 'jid');
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

    const jid = requireResolvedChatId(args, 'jid');
    if (typeof jid !== "string") return jid;

    await resolved.engine.unblockContact(jid);

    return {
      success: true,
      output: `Contact ${jid} has been unblocked.`,
      metadata: { jid, action: 'unblock' },
    };
  });
}

// ─── WhatsAppResolveContact ──────────────────────────────────────────────

export async function whatsappResolveContact(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('resolve contact', async () => {
    const query = requireString(args, 'query');
    if (typeof query !== 'string') return query;

    const directory = getContactDirectoryStoreInstance();
    if (!directory) {
      return {
        success: false,
        output: 'WhatsApp contact directory is not available. Enable and link WhatsApp first.',
        error: 'WHATSAPP_NOT_CONFIGURED',
      };
    }

    return formatResolveForTool(directory.resolve(query));
  });
}

// ─── WhatsAppRememberContactAlias ────────────────────────────────────────

export async function whatsappRememberContactAlias(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('remember contact alias', async () => {
    const alias = requireString(args, 'alias');
    if (typeof alias !== 'string') return alias;

    const directory = getContactDirectoryStoreInstance();
    if (!directory) {
      return {
        success: false,
        output: 'WhatsApp contact directory is not available. Enable and link WhatsApp first.',
        error: 'WHATSAPP_NOT_CONFIGURED',
      };
    }

    const jidArg = optionalString(args, 'jid');
    const query = optionalString(args, 'query');
    let jid = jidArg;
    if (!jid && query) {
      const resolved = directory.resolve(query);
      if (resolved.status !== 'unique') return formatResolveForTool(resolved);
      jid = resolved.contact.jid;
    }
    if (!jid) {
      return {
        success: false,
        output: 'Provide query (a unique name) or jid for the contact to nickname.',
        error: 'MISSING_INPUT',
      };
    }

    const remembered = await directory.rememberAlias(jid, alias);
    if (!remembered.ok) {
      return { success: false, output: remembered.reason, error: 'ALIAS_CONFLICT' };
    }
    return {
      success: true,
      output: `I'll remember "${alias}" as ${contactDisplayName(remembered.contact)} (${remembered.contact.jid}).`,
      metadata: { contact: remembered.contact, alias },
    };
  });
}

// ─── WhatsAppSyncContacts ────────────────────────────────────────────────

export async function whatsappSyncContacts(
  _args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('sync contacts', async () => {
    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const n = await resolved.sessionService.syncContactsFromEngine();
    const directory = getContactDirectoryStoreInstance();
    const total = directory?.count() ?? n;
    return {
      success: true,
      output: `Synced WhatsApp contacts. Indexed ${total} contact(s) (saved name, business name, profile name, phone, JID).`,
      metadata: { upserted: n, total },
    };
  });
}

// ─── WhatsAppListContacts ────────────────────────────────────────────────

export async function whatsappListContacts(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('list contacts', async () => {
    const directory = getContactDirectoryStoreInstance();
    const limit = typeof args['limit'] === 'number' ? Math.min(args['limit'], 500) : 50;
    const search = typeof args['search'] === 'string' ? args['search'] : undefined;

    if (directory && directory.count() > 0) {
      const contacts = directory.search(search, limit);
      if (contacts.length === 0) {
        return {
          success: true,
          output: search
            ? `No indexed contacts match "${search}". Try whatsapp_resolve_contact or a fuller name.`
            : 'Contact directory is empty.',
          metadata: { count: 0 },
        };
      }
      return {
        success: true,
        output: `Indexed ${directory.count()} WhatsApp contact(s); showing ${contacts.length}:\n${contacts.map(formatContactLine).join('\n')}`,
        metadata: { count: contacts.length, total: directory.count(), contacts },
      };
    }

    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    if (!resolved.engine.listContacts) {
      return {
        success: false,
        output: 'This WhatsApp engine does not support listing contacts. Use WhatsAppCheckNumber to verify a specific number.',
        error: 'NOT_SUPPORTED',
      };
    }

    const contacts = await resolved.engine.listContacts({ limit, search });
    void directory?.upsertFromEngine(contacts);

    if (contacts.length === 0) {
      return {
        success: true,
        output: search
          ? `No contacts found matching "${search}".`
          : 'No contacts available yet. WhatsApp is still syncing the address book — try again in a moment.',
        metadata: { count: 0 },
      };
    }

    const lines = contacts.map((c) => {
      const name = c.savedName ?? c.name ?? c.notify ?? c.businessName ?? c.phoneNumber ?? c.jid;
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
    const query = optionalString(args, 'query') ?? (typeof args['jid'] === 'string' ? args['jid'] : undefined);
    if (!query) {
      return {
        success: false,
        output: 'Provide query or jid (name, business name, phone, or JID).',
        error: 'MISSING_INPUT',
      };
    }

    const directory = getContactDirectoryStoreInstance();
    if (directory && directory.count() > 0) {
      return formatResolveForTool(directory.resolve(query));
    }

    const resolved = requireEngine();
    if ("error" in resolved) return resolved.error;

    const jid = requireString(args, 'jid');
    if (typeof jid !== "string") {
      return {
        success: false,
        output: 'Contact directory is empty. Provide a JID or wait for WhatsApp to sync contacts.',
        error: 'NOT_FOUND',
      };
    }

    if (!resolved.engine.listContacts) {
      return {
        success: false,
        output: 'This WhatsApp engine does not support contact lookup. Use WhatsAppCheckNumber to verify a number.',
        error: 'NOT_SUPPORTED',
      };
    }

    const contacts = await resolved.engine.listContacts({ limit: 500 });
    const contact = contacts.find((c) => c.jid === jid || c.rawJid === jid);
    if (!contact) {
      return {
        success: false,
        output: `No contact found with JID ${jid}. Try WhatsAppCheckNumber or wait for the address book to sync.`,
        error: 'NOT_FOUND',
      };
    }

    return {
      success: true,
      output: `Contact: ${contact.savedName ?? contact.name ?? contact.notify ?? 'Unknown'}\nJID: ${contact.jid}\nPhone: ${contact.phoneNumber ?? 'N/A'}${contact.businessName ? `\nBusiness: ${contact.businessName}` : ''}${contact.status ? `\nStatus: ${contact.status}` : ''}`,
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

    const jid = requireResolvedChatId(args, 'jid');
    if (typeof jid !== "string") return jid;

    if (!resolved.engine.getProfilePicture) {
      return {
        success: false,
        output: 'This WhatsApp engine does not support fetching profile pictures.',
        error: 'NOT_SUPPORTED',
      };
    }

    const { url } = await resolved.engine.getProfilePicture(jid);

    if (!url) {
      return {
        success: true,
        output: `No profile picture available for ${jid} (the contact may have hidden it or not set one).`,
        metadata: { jid, url: null },
      };
    }

    return {
      success: true,
      output: `Profile picture URL for ${jid}: ${url}`,
      metadata: { jid, url },
    };
  });
}
