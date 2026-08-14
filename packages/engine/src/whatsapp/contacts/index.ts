export type { IndexedContact, ResolveResult } from './types.js';
export { ContactDirectoryStore } from './ContactDirectoryStore.js';
export { resolveContact } from './resolveContact.js';
export { mapEngineContact, mergeIndexedContact } from './mapEngineContact.js';
export {
  buildSearchText,
  contactDisplayName,
  digitsOnly,
  looksLikeJid,
  looksLikePhone,
  normalizePersonName,
  queryToNeutralJid,
  splitSavedName,
} from './normalize.js';
export { formatContactLine, formatResolveForTool } from './formatContact.js';
