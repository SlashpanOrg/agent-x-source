import { contactDisplayName } from './normalize.js';
import type { IndexedContact, ResolveResult } from './types.js';

export function formatContactLine(c: IndexedContact): string {
  const bits = [
    contactDisplayName(c),
    c.savedName && c.savedName !== contactDisplayName(c) ? `saved: ${c.savedName}` : '',
    c.businessName && c.businessName !== c.savedName ? `business: ${c.businessName}` : '',
    c.notifyName && c.notifyName !== c.savedName && c.notifyName !== c.businessName ? `WA: ${c.notifyName}` : '',
    c.phone ? `+${c.phone}` : '',
    c.jid,
    c.aliases.length ? `aka: ${c.aliases.join(', ')}` : '',
    !c.sendable ? '(phone unknown — cannot send yet)' : '',
  ].filter(Boolean);
  return `• ${bits.join(' · ')}`;
}

export function formatResolveForTool(result: ResolveResult): {
  success: boolean;
  output: string;
  error?: string;
  metadata: Record<string, unknown>;
} {
  if (result.status === 'unique') {
    const c = result.contact;
    return {
      success: true,
      output: [
        `Resolved "${result.reason === 'literal-jid' ? c.jid : contactDisplayName(c)}" → ${c.jid}`,
        formatContactLine(c),
        !c.sendable ? 'This contact has no phone JID yet. Ask the owner for the number or wait until WhatsApp maps it.' : '',
      ].filter(Boolean).join('\n'),
      metadata: { status: 'unique', reason: result.reason, contact: c, jid: c.jid },
    };
  }
  if (result.status === 'ambiguous') {
    const lines = result.candidates.slice(0, 12).map(formatContactLine);
    return {
      success: false,
      output: [
        `Several WhatsApp contacts match "${result.query}" (${result.reason}). Ask the owner which one — do not guess.`,
        ...lines,
        result.candidates.length > 12 ? `…and ${result.candidates.length - 12} more.` : '',
      ].filter(Boolean).join('\n'),
      error: 'AMBIGUOUS_CONTACT',
      metadata: { status: 'ambiguous', query: result.query, candidates: result.candidates },
    };
  }
  return {
    success: false,
    output: `No WhatsApp contact matches "${result.query}". Try a full name, business name, phone number, or whatsapp_list_contacts / whatsapp_check_number. Do not invent a JID.`,
    error: 'CONTACT_NOT_FOUND',
    metadata: { status: 'none', query: result.query },
  };
}
