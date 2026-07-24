/**
 * WhatsApp JID parsing & normalization.
 *
 * WhatsApp's multi-device protocol emits several JID "dialects" depending on
 * which client/library surfaced it:
 *   - `<phone>@s.whatsapp.net`         — raw protocol / Baileys user dialect
 *   - `<lid>@lid`                      — privacy ID (phone number withheld)
 *   - `<id>@g.us`                      — group
 *   - `status@broadcast`               — status/stories
 *   - `<id>@newsletter`                — channel
 *   - `<id>@broadcast`                 — broadcast list
 *   - `<local>:<device>@<domain>`      — multi-device suffix
 *
 * We normalize everything to one neutral dialect so the rest of the codebase
 * never has to special-case which library produced a given id:
 *   - `<phone>@c.us`   — user, resolved to a phone number
 *   - `<lid>@lid`       — user, phone unknown/unresolved
 *   - `<id>@g.us`       — group (unchanged)
 *   - `status@broadcast` / `<id>@newsletter` / `<id>@broadcast` — unchanged
 *
 * Device suffixes (`:0`, `:12`, ...) are always stripped in the neutral form.
 *
 * This is derived from first principles against the JID shapes Baileys and
 * whatsapp-web.js actually emit (see IWhatsAppEngine.ts / BaileysEngine.ts),
 * not copied from any reference project — JID dialect handling is an
 * inherent property of the WhatsApp protocol itself, not anyone's IP.
 */

export type WaIdKind = 'user' | 'group' | 'lid' | 'status' | 'newsletter' | 'broadcast' | 'unknown';

export interface ParsedWaId {
  kind: WaIdKind;
  /** The local part with any `:device` suffix stripped. */
  id: string;
  /** Original device id, if a `:device` suffix was present. */
  device?: number;
  domain: string;
}

const USER_DOMAINS = new Set(['s.whatsapp.net', 'c.us']);

export function parseWaId(jid: string): ParsedWaId {
  const atIndex = jid.lastIndexOf('@');
  if (atIndex === -1) {
    return { kind: 'unknown', id: jid, domain: '' };
  }

  const localRaw = jid.slice(0, atIndex);
  const domain = jid.slice(atIndex + 1);

  let local = localRaw;
  let device: number | undefined;
  const colonIndex = localRaw.indexOf(':');
  if (colonIndex !== -1) {
    local = localRaw.slice(0, colonIndex);
    const deviceStr = localRaw.slice(colonIndex + 1);
    const parsed = Number(deviceStr);
    if (Number.isFinite(parsed)) device = parsed;
  }

  if (domain === 'g.us') {
    return { kind: 'group', id: local, domain };
  }
  if (domain === 'lid') {
    return { kind: 'lid', id: local, device, domain };
  }
  if (domain === 'broadcast') {
    if (local === 'status') return { kind: 'status', id: local, domain };
    return { kind: 'broadcast', id: local, domain };
  }
  if (domain === 'newsletter') {
    return { kind: 'newsletter', id: local, domain };
  }
  if (USER_DOMAINS.has(domain)) {
    return { kind: 'user', id: local, device, domain };
  }

  return { kind: 'unknown', id: local, device, domain };
}

/**
 * Normalize a JID to the neutral dialect. `resolvePhone` is an optional
 * synchronous lookup (backed by LidMappingStore, Phase 4.2) used to resolve
 * `@lid` ids to a phone number when one is already known; if it returns
 * undefined/null, the `@lid` form is preserved rather than guessed at.
 */
export function toNeutralJid(jid: string, resolvePhone?: (lid: string) => string | null | undefined): string {
  const parsed = parseWaId(jid);

  switch (parsed.kind) {
    case 'user':
      return `${parsed.id}@c.us`;
    case 'group':
      return `${parsed.id}@g.us`;
    case 'lid': {
      const resolved = resolvePhone?.(parsed.id);
      return resolved ? `${resolved}@c.us` : `${parsed.id}@lid`;
    }
    case 'status':
      return 'status@broadcast';
    case 'newsletter':
      return `${parsed.id}@newsletter`;
    case 'broadcast':
      return `${parsed.id}@broadcast`;
    default:
      return jid;
  }
}

export type ChatKind = 'individual' | 'group' | 'channel' | 'status' | 'broadcast' | 'unknown';

export function chatKind(jid: string): ChatKind {
  const parsed = parseWaId(jid);
  switch (parsed.kind) {
    case 'user':
    case 'lid':
      return 'individual';
    case 'group':
      return 'group';
    case 'newsletter':
      return 'channel';
    case 'status':
      return 'status';
    case 'broadcast':
      return 'broadcast';
    default:
      return 'unknown';
  }
}

/** True if the JID is in the `@lid` privacy-id dialect (phone unresolved). */
export function isLidJid(jid: string): boolean {
  return parseWaId(jid).kind === 'lid';
}

/** Bare phone number from a neutral `@c.us` user JID, or undefined if not that dialect. */
export function phoneFromNeutralJid(jid: string): string | undefined {
  const parsed = parseWaId(jid);
  return parsed.kind === 'user' && parsed.domain === 'c.us' ? parsed.id : undefined;
}
