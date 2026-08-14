import { describe, expect, it } from 'vitest';
import { mapEngineContact, mergeIndexedContact } from '../src/whatsapp/contacts/mapEngineContact.js';
import { buildSearchText, contactDisplayName, splitSavedName } from '../src/whatsapp/contacts/normalize.js';
import { resolveContact } from '../src/whatsapp/contacts/resolveContact.js';
import type { IndexedContact } from '../src/whatsapp/contacts/types.js';

function contact(partial: Partial<IndexedContact> & Pick<IndexedContact, 'jid'>): IndexedContact {
  const aliases = partial.aliases ?? [];
  const base: IndexedContact = {
    jid: partial.jid,
    phone: partial.phone,
    lidJid: partial.lidJid,
    savedName: partial.savedName,
    firstName: partial.firstName,
    lastName: partial.lastName,
    notifyName: partial.notifyName,
    businessName: partial.businessName,
    username: partial.username,
    isSaved: partial.isSaved ?? Boolean(partial.savedName),
    sendable: partial.sendable ?? !partial.jid.endsWith('@lid'),
    aliases,
    searchText: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  if (!base.firstName && base.savedName) {
    const split = splitSavedName(base.savedName);
    base.firstName = split.firstName;
    base.lastName = split.lastName;
  }
  base.searchText = buildSearchText(base);
  return { ...base, ...partial, searchText: partial.searchText || buildSearchText({ ...base, ...partial }) };
}

const priya = contact({
  jid: '15551111111@c.us',
  phone: '15551111111',
  savedName: 'Priya Pots',
  notifyName: 'Priya',
});
const priyaWork = contact({
  jid: '15552222222@c.us',
  phone: '15552222222',
  savedName: 'Priya Shah',
  businessName: 'Shah Design',
});
const school = contact({
  jid: '15553333333@c.us',
  phone: '15553333333',
  savedName: 'Lincoln High',
  businessName: 'Lincoln High School',
});
const mom = contact({
  jid: '15554444444@c.us',
  phone: '15554444444',
  savedName: 'Anjali Kumar',
  aliases: ['Mom'],
});

const book = [priya, priyaWork, school, mom];

describe('resolveContact', () => {
  it('resolves a unique saved full name to the neutral JID', () => {
    const hit = resolveContact('Priya Pots', book);
    expect(hit.status).toBe('unique');
    if (hit.status === 'unique') expect(hit.contact.jid).toBe('15551111111@c.us');
  });

  it('resolves first name only when it is unique', () => {
    const anjali = resolveContact('Anjali', book);
    expect(anjali.status).toBe('unique');
    if (anjali.status === 'unique') expect(anjali.contact.jid).toBe(mom.jid);
  });

  it('does not guess when two people share a first name', () => {
    const hit = resolveContact('Priya', book);
    expect(hit.status).toBe('ambiguous');
    if (hit.status === 'ambiguous') {
      expect(hit.candidates.map((c) => c.jid).sort()).toEqual([priya.jid, priyaWork.jid].sort());
    }
  });

  it('resolves a business name', () => {
    const hit = resolveContact('Shah Design', book);
    expect(hit.status).toBe('unique');
    if (hit.status === 'unique') expect(hit.contact.jid).toBe(priyaWork.jid);
  });

  it('resolves an owner-taught alias', () => {
    const hit = resolveContact('mom', book);
    expect(hit.status).toBe('unique');
    if (hit.status === 'unique') expect(hit.contact.jid).toBe(mom.jid);
  });

  it('resolves a phone number and an @s.whatsapp.net JID to @c.us', () => {
    const byPhone = resolveContact('+1 (555) 111-1111', book);
    expect(byPhone.status).toBe('unique');
    if (byPhone.status === 'unique') expect(byPhone.contact.jid).toBe(priya.jid);

    const byJid = resolveContact('15551111111@s.whatsapp.net', book);
    expect(byJid.status).toBe('unique');
    if (byJid.status === 'unique') expect(byJid.contact.jid).toBe(priya.jid);
  });

  it('allows sending to an unsaved number without inventing a name match', () => {
    const hit = resolveContact('15559990000', book);
    expect(hit.status).toBe('unique');
    if (hit.status === 'unique') {
      expect(hit.contact.jid).toBe('15559990000@c.us');
      expect(hit.contact.isSaved).toBe(false);
    }
  });

  it('matches first name + last initial when unique', () => {
    const hit = resolveContact('Priya P', book);
    expect(hit.status).toBe('unique');
    if (hit.status === 'unique') expect(hit.contact.jid).toBe(priya.jid);
  });

  it('returns none instead of a fuzzy guess', () => {
    expect(resolveContact('the guy from yoga', book).status).toBe('none');
  });

  it('token-matches a unique business word', () => {
    const hit = resolveContact('lincoln', book);
    expect(hit.status).toBe('unique');
    if (hit.status === 'unique') expect(hit.contact.jid).toBe(school.jid);
  });
});

describe('mapEngineContact / merge', () => {
  it('keeps saved vs notify vs business names separate and uses a neutral JID', () => {
    const mapped = mapEngineContact({
      jid: '15551111111@s.whatsapp.net',
      rawJid: '15551111111@s.whatsapp.net',
      phoneNumber: '15551111111@s.whatsapp.net',
      name: 'Priya Pots',
      savedName: 'Priya Pots',
      notify: 'Priya',
      businessName: undefined,
    });
    expect(mapped?.jid).toBe('15551111111@c.us');
    expect(mapped?.savedName).toBe('Priya Pots');
    expect(mapped?.notifyName).toBe('Priya');
    expect(mapped?.firstName).toBe('Priya');
    expect(mapped?.lastName).toBe('Pots');
    expect(mapped?.isSaved).toBe(true);
  });

  it('does not let a notify-only update wipe a saved name', () => {
    const prev = priya;
    const incoming = contact({
      jid: priya.jid,
      phone: priya.phone,
      notifyName: 'P',
      isSaved: false,
    });
    const merged = mergeIndexedContact(prev, incoming);
    expect(merged.savedName).toBe('Priya Pots');
    expect(merged.isSaved).toBe(true);
    expect(merged.notifyName).toBe('P');
  });

  it('display name prefers the address-book name', () => {
    expect(contactDisplayName(priya)).toBe('Priya Pots');
    expect(contactDisplayName(school)).toBe('Lincoln High');
  });
});
