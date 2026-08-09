import { describe, expect, it } from 'vitest';
import {
  formatClientSituationBlock,
  isClientLocationKnown,
  normalizeClientSituation,
  resolveClientTimezone,
  clientLocationCityLabel,
} from '@agentx/shared';

describe('normalizeClientSituation', () => {
  it('accepts valid browser payload', () => {
    const situation = normalizeClientSituation({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'browser',
      latitude: 12.97,
      longitude: 77.59,
      accuracyMeters: 120,
      locationLabel: 'Chennai, Tamil Nadu, India',
      locationMethod: 'gps',
    });
    expect(situation).toMatchObject({
      timezone: 'Asia/Kolkata',
      source: 'browser',
      latitude: 12.97,
      longitude: 77.59,
      locationLabel: 'Chennai, Tamil Nadu, India',
    });
  });

  it('accepts user_set location', () => {
    const situation = normalizeClientSituation({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'desktop',
      locationLabel: 'Chennai, India',
      locationMethod: 'user_set',
    });
    expect(situation?.locationMethod).toBe('user_set');
    expect(isClientLocationKnown(situation)).toBe(true);
  });

  it('rejects invalid payloads', () => {
    expect(normalizeClientSituation(null)).toBeNull();
    expect(normalizeClientSituation({ clientNow: 'bad', timezone: 'UTC', source: 'browser' })).toBeNull();
  });
});

describe('isClientLocationKnown', () => {
  it('is false without a label', () => {
    expect(isClientLocationKnown({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'browser',
    })).toBe(false);
  });

  it('extracts city label', () => {
    const situation = normalizeClientSituation({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'browser',
      locationLabel: 'Chennai, Tamil Nadu, India',
      locationMethod: 'user_set',
    });
    expect(clientLocationCityLabel(situation)).toBe('Chennai');
  });
});

describe('formatClientSituationBlock', () => {
  it('includes timezone and GPS city', () => {
    const block = formatClientSituationBlock({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'desktop',
      latitude: 12.97,
      longitude: 77.59,
      locationLabel: 'Chennai, Tamil Nadu, India',
      locationMethod: 'gps',
      locationConfidence: 'high',
    });
    expect(block).toContain('[CLIENT_SITUATION]');
    expect(block).toContain('Asia/Kolkata');
    expect(block).toContain('Chennai');
    expect(block).toContain('device GPS');
  });

  it('marks location not available without a place', () => {
    const block = formatClientSituationBlock({
      clientNow: '2026-07-06T14:00:00.000Z',
      timezone: 'Asia/Kolkata',
      source: 'browser',
    });
    expect(block).toContain('NOT AVAILABLE');
    expect(block).toContain('set_user_location');
    expect(block).not.toContain('Coordinates:');
  });
});

describe('resolveClientTimezone', () => {
  it('prefers client situation timezone', () => {
    expect(resolveClientTimezone({ clientNow: '2026-07-06T14:00:00.000Z', timezone: 'Europe/London', source: 'browser' }, 'UTC')).toBe('Europe/London');
  });
});
