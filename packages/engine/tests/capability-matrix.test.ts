import { describe, it, expect } from 'vitest';
import { CAPABILITY_MATRIX, engineSupportsCapability, preferredEngineForCapability } from '../src/whatsapp/engine/capability-matrix.js';

describe('capability-matrix', () => {
  describe('CAPABILITY_MATRIX', () => {
    it('covers all extended capabilities', () => {
      const expected = [
        'labels', 'catalog', 'statusStories', 'channels',
        'chatHistoryFetch', 'messageReactionsQuery',
        'rejectCall', 'groupManagement',
      ];
      for (const cap of expected) {
        expect(CAPABILITY_MATRIX[cap as keyof typeof CAPABILITY_MATRIX]).toBeDefined();
      }
    });

    it('marks rejectCall as Baileys-only', () => {
      expect(CAPABILITY_MATRIX.rejectCall).toEqual(['baileys']);
    });

    it('marks groupManagement as supported by both engines', () => {
      expect(CAPABILITY_MATRIX.groupManagement).toContain('baileys');
      expect(CAPABILITY_MATRIX.groupManagement).toContain('electron-wwebjs');
    });

    it('marks extended UI capabilities as wwebjs-preferred', () => {
      const wwebjsPreferred = ['labels', 'catalog', 'statusStories', 'channels', 'chatHistoryFetch', 'messageReactionsQuery'];
      for (const cap of wwebjsPreferred) {
        expect(CAPABILITY_MATRIX[cap as keyof typeof CAPABILITY_MATRIX][0]).toBe('electron-wwebjs');
      }
    });
  });

  describe('engineSupportsCapability', () => {
    it('returns true for Baileys + rejectCall', () => {
      expect(engineSupportsCapability('baileys', 'rejectCall')).toBe(true);
    });

    it('returns false for wwebjs + rejectCall', () => {
      expect(engineSupportsCapability('electron-wwebjs', 'rejectCall')).toBe(false);
    });

    it('returns true for wwebjs + labels', () => {
      expect(engineSupportsCapability('electron-wwebjs', 'labels')).toBe(true);
    });

    it('returns true for both engines + groupManagement', () => {
      expect(engineSupportsCapability('baileys', 'groupManagement')).toBe(true);
      expect(engineSupportsCapability('electron-wwebjs', 'groupManagement')).toBe(true);
    });
  });

  describe('preferredEngineForCapability', () => {
    it('returns baileys for rejectCall', () => {
      expect(preferredEngineForCapability('rejectCall')).toBe('baileys');
    });

    it('returns electron-wwebjs for labels', () => {
      expect(preferredEngineForCapability('labels')).toBe('electron-wwebjs');
    });

    it('returns baileys for groupManagement (first in list)', () => {
      expect(preferredEngineForCapability('groupManagement')).toBe('baileys');
    });
  });
});
