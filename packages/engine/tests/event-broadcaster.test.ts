import { describe, it, expect } from 'vitest';
import { EventBroadcaster } from '../src/communication/EventBroadcaster.js';

describe('EventBroadcaster', () => {
  it('registers and unregisters targets', () => {
    const broadcaster = new EventBroadcaster();
    const sent: Record<string, unknown>[] = [];

    const target = {
      connId: 'conn-1',
      sessionId: 'sess-1',
      send: (event: Record<string, unknown>) => sent.push(event),
    };

    broadcaster.register(target);
    expect(broadcaster.getTargetCount()).toBe(1);

    broadcaster.unregister('conn-1');
    expect(broadcaster.getTargetCount()).toBe(0);
  });

  it('broadcasts to session-scoped targets', () => {
    const broadcaster = new EventBroadcaster(0); // no throttle
    const sent: Record<string, unknown>[] = [];

    broadcaster.register({
      connId: 'conn-1',
      sessionId: 'sess-1',
      send: (e) => sent.push(e),
    });

    broadcaster.register({
      connId: 'conn-2',
      sessionId: 'sess-2',
      send: (e) => sent.push(e),
    });

    broadcaster.broadcastToSession(
      { type: 'turn.start', turnId: 't1', sessionId: 's1', ts: 0 },
      'sess-1',
    );

    expect(sent).toHaveLength(1);
  });
});
