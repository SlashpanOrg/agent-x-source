import { describe, expect, it } from 'vitest';
import {
  formatOwnerPublicName,
  formatOwnerReferralExample,
  isOwnerEmailValid,
  mergeUserConfig,
  normalizeOwnerNames,
  ownerPronouns,
  renderOwnerIdentityPrompt,
} from '../src/utils/owner-identity.js';

describe('owner identity', () => {
  it('formats public name with prefix and never falls back to callsign', () => {
    expect(formatOwnerPublicName({ callsign: 'Mitra', name: 'Siva', prefix: 'Mr.' })).toBe('Mr. Siva');
    expect(formatOwnerPublicName({ callsign: 'Mitra' })).toBe('');
    expect(formatOwnerPublicName({ callsign: 'Mitra', name: 'Siva' })).toBe('Siva');
    expect(formatOwnerPublicName({ callsign: 'Mitra', names: ['Siva', 'Siv'], prefix: 'Mr.' })).toBe('Mr. Siva');
  });

  it('normalizes names from legacy name or names array and dedupes', () => {
    expect(normalizeOwnerNames({ name: 'Siva' })).toEqual(['Siva']);
    expect(normalizeOwnerNames({ names: ['Siva', 'SIVA', 'siv', ' Mitra '], name: 'Ignored' })).toEqual(['Siva', 'siv', 'Mitra']);
    expect(normalizeOwnerNames({ names: [] })).toEqual([]);
  });

  it('builds a third-party referral example with the right pronoun', () => {
    expect(formatOwnerReferralExample({
      callsign: 'Mitra',
      name: 'Siva',
      prefix: 'Mr.',
      gender: 'male',
    })).toBe('Mr. Siva is busy with a meeting; I will share your message with him.');
    expect(formatOwnerReferralExample({
      callsign: 'Mitra',
      name: 'Ada',
      prefix: 'Dr.',
      gender: 'female',
    })).toBe('Dr. Ada is busy with a meeting; I will share your message with her.');
  });

  it('keeps they/them when gender is unspecified', () => {
    expect(ownerPronouns('unspecified').object).toBe('them');
  });

  it('treats empty email as valid and rejects junk', () => {
    expect(isOwnerEmailValid('')).toBe(true);
    expect(isOwnerEmailValid('owner@example.com')).toBe(true);
    expect(isOwnerEmailValid('not-an-email')).toBe(false);
  });

  it('merges identity fields without dropping callsign and keeps names in sync', () => {
    const merged = mergeUserConfig(
      { callsign: 'Mitra', name: 'Siva', prefix: 'Mr.' },
      { gender: 'male', email: 'siva@example.com' },
    );
    expect(merged).toEqual({
      callsign: 'Mitra',
      name: 'Siva',
      names: ['Siva'],
      prefix: 'Mr.',
      gender: 'male',
      email: 'siva@example.com',
    });
  });

  it('replaces public names from a names patch', () => {
    const merged = mergeUserConfig(
      { callsign: 'Mitra', names: ['Siva'], name: 'Siva' },
      { names: ['Siva', 'Siv'] },
    );
    expect(merged.names).toEqual(['Siva', 'Siv']);
    expect(merged.name).toBe('Siva');
  });

  it('keeps extra nicknames when a patch only repeats the first name', () => {
    const merged = mergeUserConfig(
      { callsign: 'Mitra', names: ['Siva', 'Siv'], name: 'Siva', prefix: 'Mr.' },
      { callsign: 'Mitra', name: 'Siva', gender: 'male' },
    );
    expect(merged.names).toEqual(['Siva', 'Siv']);
    expect(merged.name).toBe('Siva');
    expect(merged.gender).toBe('male');
  });

  it('tells the model callsign is for the owner and public names are for everyone else', () => {
    const block = renderOwnerIdentityPrompt({
      callsign: 'Mitra',
      names: ['Siva', 'Siv'],
      prefix: 'Mr.',
      gender: 'male',
    });
    expect(block).toContain('Callsign: "Mitra"');
    expect(block).toContain('"Siva", "Siv"');
    expect(block).toContain('pick ONE of those names at random');
    expect(block).toContain('Never use the callsign with third parties');
    expect(block).not.toMatch(/name\/callsign/);
  });
});
