/**
 * AckTracker + MediaHandler tests (Phase 4.6).
 *
 * Tests cover:
 *   - Forward-only ack transitions (no downgrade from read → delivered)
 *   - Terminal `failed` status
 *   - Inbound media size cap logic
 *   - SSRF guard for outbound media fetch (private IP blocking)
 *   - URL protocol validation
 */
import { describe, it, expect } from 'vitest';
import { AckTracker } from '../src/whatsapp/AckTracker.js';
import {
  resolveInboundMedia as resolveMedia,
  shouldOmitMedia as shouldOmit,
  isPrivateIp as isPrivate,
  validateUrlSafe as validateUrl,
  DEFAULT_INBOUND_MEDIA_CAP_BYTES,
} from '../src/whatsapp/MediaHandler.js';

describe('AckTracker — forward-only transitions', () => {
  it('accepts the first status for a message', () => {
    const tracker = new AckTracker();
    expect(tracker.transition('msg-1', 'sent')).toBe('sent');
    expect(tracker.get('msg-1')).toBe('sent');
  });

  it('accepts forward transitions (pending → sent → delivered → read)', () => {
    const tracker = new AckTracker();
    expect(tracker.transition('msg-1', 'pending')).toBe('pending');
    expect(tracker.transition('msg-1', 'sent')).toBe('sent');
    expect(tracker.transition('msg-1', 'delivered')).toBe('delivered');
    expect(tracker.transition('msg-1', 'read')).toBe('read');
  });

  it('rejects downgrades (read → delivered stays read)', () => {
    const tracker = new AckTracker();
    tracker.transition('msg-1', 'read');
    expect(tracker.transition('msg-1', 'delivered')).toBe('read');
    expect(tracker.transition('msg-1', 'sent')).toBe('read');
    expect(tracker.transition('msg-1', 'pending')).toBe('read');
  });

  it('rejects same-level transitions (read → read stays read)', () => {
    const tracker = new AckTracker();
    tracker.transition('msg-1', 'read');
    expect(tracker.transition('msg-1', 'read')).toBe('read');
  });

  it('treats failed as terminal — no further transitions', () => {
    const tracker = new AckTracker();
    tracker.transition('msg-1', 'sent');
    expect(tracker.transition('msg-1', 'failed')).toBe('failed');
    expect(tracker.transition('msg-1', 'read')).toBe('failed');
    expect(tracker.transition('msg-1', 'delivered')).toBe('failed');
  });

  it('accepts failed from any status', () => {
    const tracker = new AckTracker();
    tracker.transition('msg-1', 'read');
    expect(tracker.transition('msg-1', 'failed')).toBe('failed');
  });

  it('wouldAccept returns true for forward transitions, false for downgrades', () => {
    const tracker = new AckTracker();
    tracker.transition('msg-1', 'delivered');
    expect(tracker.wouldAccept('msg-1', 'read')).toBe(true);
    expect(tracker.wouldAccept('msg-1', 'sent')).toBe(false);
    expect(tracker.wouldAccept('msg-1', 'failed')).toBe(true);
  });

  it('wouldAccept returns true for untracked messages', () => {
    const tracker = new AckTracker();
    expect(tracker.wouldAccept('msg-unknown', 'sent')).toBe(true);
  });

  it('clears all tracked statuses', () => {
    const tracker = new AckTracker();
    tracker.transition('msg-1', 'sent');
    tracker.transition('msg-2', 'read');
    expect(tracker.size).toBe(2);
    tracker.clear();
    expect(tracker.size).toBe(0);
    expect(tracker.get('msg-1')).toBeUndefined();
  });

  it('handles multiple messages independently', () => {
    const tracker = new AckTracker();
    tracker.transition('msg-1', 'read');
    tracker.transition('msg-2', 'sent');
    expect(tracker.get('msg-1')).toBe('read');
    expect(tracker.get('msg-2')).toBe('sent');
    expect(tracker.transition('msg-2', 'delivered')).toBe('delivered');
    expect(tracker.get('msg-1')).toBe('read'); // unchanged
  });
});

describe('MediaHandler — inbound size cap', () => {
  it('shouldOmitMedia returns false for small media', () => {
    expect(shouldOmit(1024, DEFAULT_INBOUND_MEDIA_CAP_BYTES)).toBe(false);
  });

  it('shouldOmitMedia returns true for media exceeding cap', () => {
    expect(shouldOmit(20 * 1024 * 1024, DEFAULT_INBOUND_MEDIA_CAP_BYTES)).toBe(true);
  });

  it('shouldOmitMedia returns false at exact cap boundary', () => {
    expect(shouldOmit(DEFAULT_INBOUND_MEDIA_CAP_BYTES, DEFAULT_INBOUND_MEDIA_CAP_BYTES)).toBe(false);
  });

  it('resolveInboundMedia includes data when within cap', () => {
    const result = resolveMedia('base64data', 1024, DEFAULT_INBOUND_MEDIA_CAP_BYTES);
    expect(result.data).toBe('base64data');
    expect(result.omitted).toBeUndefined();
  });

  it('resolveInboundMedia omits data when exceeding cap', () => {
    const result = resolveMedia('base64data', 20 * 1024 * 1024, DEFAULT_INBOUND_MEDIA_CAP_BYTES);
    expect(result.data).toBeUndefined();
    expect(result.omitted).toBe(true);
    expect(result.sizeBytes).toBe(20 * 1024 * 1024);
  });
});

describe('MediaHandler — SSRF guard', () => {
  it('isPrivateIp detects loopback 127.x.x.x', () => {
    expect(isPrivate('127.0.0.1')).toBe(true);
    expect(isPrivate('127.255.255.255')).toBe(true);
  });

  it('isPrivateIp detects private 10.x.x.x', () => {
    expect(isPrivate('10.0.0.1')).toBe(true);
    expect(isPrivate('10.255.255.255')).toBe(true);
  });

  it('isPrivateIp detects private 172.16-31.x.x', () => {
    expect(isPrivate('172.16.0.1')).toBe(true);
    expect(isPrivate('172.31.255.255')).toBe(true);
  });

  it('isPrivateIp does NOT flag 172.15.x.x or 172.32.x.x', () => {
    expect(isPrivate('172.15.0.1')).toBe(false);
    expect(isPrivate('172.32.0.1')).toBe(false);
  });

  it('isPrivateIp detects private 192.168.x.x', () => {
    expect(isPrivate('192.168.0.1')).toBe(true);
    expect(isPrivate('192.168.1.100')).toBe(true);
  });

  it('isPrivateIp detects link-local 169.254.x.x', () => {
    expect(isPrivate('169.254.0.1')).toBe(true);
  });

  it('isPrivateIp detects IPv6 loopback', () => {
    expect(isPrivate('::1')).toBe(true);
  });

  it('isPrivateIp detects IPv6 unique local fc/fd', () => {
    expect(isPrivate('fc00::1')).toBe(true);
    expect(isPrivate('fd00::1')).toBe(true);
  });

  it('isPrivateIp detects IPv6 link-local fe80:', () => {
    expect(isPrivate('fe80::1')).toBe(true);
  });

  it('isPrivateIp detects IPv6-mapped IPv4 private addresses', () => {
    expect(isPrivate('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivate('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivate('::ffff:192.168.1.1')).toBe(true);
  });

  it('isPrivateIp returns false for public IPs', () => {
    expect(isPrivate('8.8.8.8')).toBe(false);
    expect(isPrivate('1.1.1.1')).toBe(false);
    expect(isPrivate('203.0.113.1')).toBe(false);
  });

  it('validateUrlSafe rejects non-http protocols', async () => {
    await expect(validateUrl('ftp://example.com/file.jpg')).rejects.toThrow('only http and https');
    await expect(validateUrl('file:///etc/passwd')).rejects.toThrow('only http and https');
  });

  it('validateUrlSafe rejects direct private IP URLs', async () => {
    await expect(validateUrl('http://127.0.0.1/admin')).rejects.toThrow('private IP');
    await expect(validateUrl('http://10.0.0.1/internal')).rejects.toThrow('private IP');
    await expect(validateUrl('http://192.168.1.1/router')).rejects.toThrow('private IP');
  });

  it('validateUrlSafe accepts public IP URLs', async () => {
    // 8.8.8.8 is Google DNS — a well-known public IP
    await expect(validateUrl('https://8.8.8.8/test')).resolves.toBeUndefined();
  });
});
