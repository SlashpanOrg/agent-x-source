import type { UserConfig, UserGender } from '../types/config.js';
import { USER_HONORIFIC_PREFIXES } from '../types/config.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_OWNER_NAMES = 12;
const MAX_OWNER_NAME_LEN = 80;

export function isUserGender(value: unknown): value is UserGender {
  return value === 'male' || value === 'female' || value === 'nonbinary' || value === 'unspecified';
}

export function isOwnerEmailValid(email: string | undefined | null): boolean {
  const t = (email ?? '').trim();
  if (!t) return true;
  return EMAIL_RE.test(t) && t.length <= 254;
}

export function normalizeHonorificPrefix(raw: string | undefined | null): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  const match = USER_HONORIFIC_PREFIXES.find((p) => p.toLowerCase() === t.toLowerCase() || p.replace(/\.$/, '').toLowerCase() === t.replace(/\.$/, '').toLowerCase());
  if (match) return match;
  return t.replace(/\s+/g, ' ').slice(0, 20);
}

/** Dedupe, trim, and cap public names. `names` wins over legacy `name`. */
export function normalizeOwnerNames(input?: { name?: string; names?: unknown } | null): string[] {
  const raw: unknown[] = Array.isArray(input?.names)
    ? input.names
    : (typeof input?.name === 'string' ? [input.name] : []);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.trim().replace(/\s+/g, ' ').slice(0, MAX_OWNER_NAME_LEN);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_OWNER_NAMES) break;
  }
  return out;
}

export function ownerPronouns(gender?: UserGender | null): { subject: string; object: string; possessive: string } {
  switch (gender) {
    case 'male':
      return { subject: 'he', object: 'him', possessive: 'his' };
    case 'female':
      return { subject: 'she', object: 'her', possessive: 'her' };
    default:
      return { subject: 'they', object: 'them', possessive: 'their' };
  }
}

/** First public name with prefix — empty when none configured. Never falls back to callsign. */
export function formatOwnerPublicName(user?: UserConfig | null): string {
  const name = normalizeOwnerNames(user)[0];
  if (!name) return '';
  const prefix = normalizeHonorificPrefix(user?.prefix);
  return prefix ? `${prefix} ${name}` : name;
}

export function formatOwnerReferralExample(user?: UserConfig | null): string {
  const publicName = formatOwnerPublicName(user);
  if (!publicName) return '';
  const p = ownerPronouns(user?.gender);
  return `${publicName} is busy with a meeting; I will share your message with ${p.object}.`;
}

function optTrim(value: string | undefined | null): string | undefined {
  const t = (value ?? '').trim();
  return t || undefined;
}

/** Merge a partial identity patch onto existing user config without dropping fields. */
export function mergeUserConfig(existing: UserConfig | undefined, patch: Partial<UserConfig>): UserConfig {
  const callsign = (patch.callsign !== undefined ? patch.callsign : existing?.callsign ?? '').trim();
  const next: UserConfig = { callsign };
  // `names` replaces the list. A lone `name` must not wipe extra nicknames —
  // Settings always syncs `name` to `names[0]`, and PUT used to pass both.
  const names = Array.isArray(patch.names)
    ? normalizeOwnerNames({ names: patch.names })
    : normalizeOwnerNames({
        names: existing?.names,
        name: patch.name !== undefined ? patch.name : existing?.name,
      });
  if (names.length) {
    next.names = names;
    next.name = names[0];
  }
  const prefix = normalizeHonorificPrefix(patch.prefix !== undefined ? patch.prefix : existing?.prefix);
  if (prefix) next.prefix = prefix;
  const gender = patch.gender !== undefined ? patch.gender : existing?.gender;
  if (gender && isUserGender(gender)) next.gender = gender;
  const email = optTrim(patch.email !== undefined ? patch.email : existing?.email);
  if (email) next.email = email;
  return next;
}

function publicNamePromptLines(user: UserConfig | null | undefined, pronouns: { subject: string; object: string; possessive: string }): string[] {
  const names = normalizeOwnerNames(user);
  if (!names.length) {
    return ['No public name is configured. When talking to other people about the owner, say "the owner" — do not invent an honorific or use the callsign.'];
  }
  const listed = names.map((n) => `"${n}"`).join(', ');
  const prefix = normalizeHonorificPrefix(user?.prefix);
  const lines: string[] = [
    `Public identity (other people only). Names/nicknames: ${listed}.`,
  ];
  if (names.length > 1) {
    lines.push('Each time you refer to the owner to someone else, pick ONE of those names at random — vary across messages; do not always use the same one.');
  }
  if (prefix) {
    lines.push(`Honorific prefix: ${prefix}. You may pair it with whichever name you picked (e.g. "${prefix} ${names[0]}").`);
  }
  lines.push(`Pronouns: ${pronouns.subject}/${pronouns.object}/${pronouns.possessive}.`);
  lines.push('Never use the callsign with third parties. Never use these public names when talking to the owner.');
  return lines;
}

export function renderOwnerIdentityPrompt(
  user: UserConfig | null | undefined,
  opts?: { crewPrivate?: boolean },
): string {
  const callsign = user?.callsign?.trim() ?? '';
  const names = normalizeOwnerNames(user);
  if (!callsign && !names.length) return '';
  const pronouns = ownerPronouns(user?.gender);
  const email = user?.email?.trim() ?? '';

  if (opts?.crewPrivate) {
    const lines = ['[USER]'];
    if (callsign) {
      lines.push(`The person's callsign is "${callsign}". Use it only when natural for YOUR specialist role in [CREW_IDENTITY].`);
      lines.push(`Do NOT adopt butler/valet/host-assistant deference (e.g. opening every reply with "${callsign},") unless your role is explicitly a butler, valet, or personal assistant.`);
    }
    if (names.length) {
      const listed = names.map((n) => `"${n}"`).join(', ');
      const prefix = normalizeHonorificPrefix(user?.prefix);
      const how = names.length > 1
        ? `pick one of ${listed} at random`
        : `use ${listed}`;
      lines.push(`If you ever refer to this person to someone else, ${how}${prefix ? ` (you may add "${prefix}")` : ''} (${pronouns.subject}/${pronouns.object}) — never the callsign.`);
    }
    lines.push('You are NOT Agent-X / JARVIS / FRIDAY / the host persona — stay in [CREW_IDENTITY].');
    lines.push('[/USER]');
    return lines.join('\n');
  }

  const lines = ['[USER]'];
  if (callsign) {
    lines.push(`Callsign: "${callsign}". When you address the owner directly (dashboard, voice, WhatsApp Message-yourself / self-chat), use this callsign — never their public name or honorific.`);
  }
  lines.push(...publicNamePromptLines(user, pronouns));
  if (email) {
    lines.push(`Owner email (use only if a task needs it): ${email}`);
  }
  lines.push('[/USER]');
  return lines.join('\n');
}
