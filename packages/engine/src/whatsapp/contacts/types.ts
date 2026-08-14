/** One indexed WhatsApp person (neutral JID). Source of truth for name → JID. */
export interface IndexedContact {
  jid: string;
  phone?: string;
  lidJid?: string;
  savedName?: string;
  firstName?: string;
  lastName?: string;
  notifyName?: string;
  businessName?: string;
  username?: string;
  isSaved: boolean;
  sendable: boolean;
  aliases: string[];
  searchText: string;
  updatedAt: string;
}

export type ResolveResult =
  | { status: 'unique'; contact: IndexedContact; reason: string }
  | { status: 'ambiguous'; query: string; candidates: IndexedContact[]; reason: string }
  | { status: 'none'; query: string };
