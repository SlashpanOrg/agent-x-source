import { describe, it, expect, beforeEach } from 'vitest';
import { WhatsAppEventBus } from '../src/whatsapp/WhatsAppEventBus.js';
import { EngineStatus } from '../src/whatsapp/engine/IWhatsAppEngine.js';
import type { WhatsAppIncomingMessage } from '../src/whatsapp/engine/IWhatsAppEngine.js';

describe('WhatsAppEventBus', () => {
  let bus: WhatsAppEventBus;

  beforeEach(() => {
    bus = new WhatsAppEventBus();
  });

  it('emits and receives message events', () => {
    const received: string[] = [];
    bus.on('message', (msg) => received.push(msg.body));

    const msg: WhatsAppIncomingMessage = {
      id: 'm1', chatId: 'c1', from: 'a', to: 'b', fromMe: false,
      isGroup: false, type: 'text', body: 'hello', timestamp: 0,
    };
    bus.emit('message', msg);
    expect(received).toEqual(['hello']);
  });

  it('emits and receives stateChanged events', () => {
    const states: EngineStatus[] = [];
    bus.on('stateChanged', (status) => states.push(status));

    bus.emit('stateChanged', EngineStatus.READY, { phoneNumber: '15551234567' });
    expect(states).toEqual([EngineStatus.READY]);
  });

  it('supports multiple subscribers', () => {
    let count = 0;
    bus.on('message', () => count++);
    bus.on('message', () => count++);

    bus.emit('message', {
      id: 'm1', chatId: 'c1', from: 'a', to: 'b', fromMe: false,
      isGroup: false, type: 'text', body: 'x', timestamp: 0,
    });
    expect(count).toBe(2);
  });

  it('supports once() listeners', () => {
    let count = 0;
    bus.once('qrCode', () => count++);

    bus.emit('qrCode', 'data:url1');
    bus.emit('qrCode', 'data:url2');
    expect(count).toBe(1);
  });

  it('supports off() to remove listeners', () => {
    const handler = () => {};
    bus.on('error', handler);
    bus.off('error', handler);
    expect(bus.listenerCount('error')).toBe(0);
  });

  it('clear() removes all listeners for a specific event', () => {
    bus.on('message', () => {});
    bus.on('message', () => {});
    bus.on('stateChanged', () => {});
    expect(bus.listenerCount('message')).toBe(2);
    expect(bus.listenerCount('stateChanged')).toBe(1);

    bus.clear('message');
    expect(bus.listenerCount('message')).toBe(0);
    expect(bus.listenerCount('stateChanged')).toBe(1);
  });

  it('clear() without args removes all listeners', () => {
    bus.on('message', () => {});
    bus.on('stateChanged', () => {});
    bus.clear();
    expect(bus.listenerCount('message')).toBe(0);
    expect(bus.listenerCount('stateChanged')).toBe(0);
  });

  it('emits messageAck events', () => {
    const acks: string[] = [];
    bus.on('messageAck', (ack) => acks.push(ack.status));
    bus.emit('messageAck', { messageId: 'm1', chatId: 'c1', status: 'read' });
    expect(acks).toEqual(['read']);
  });

  it('emits messageReaction events', () => {
    const reactions: { emoji: string | null }[] = [];
    bus.on('messageReaction', (_chatId, _msgId, _sender, emoji) => reactions.push({ emoji }));
    bus.emit('messageReaction', 'c1', 'm1', 'sender1', '👍');
    bus.emit('messageReaction', 'c1', 'm1', 'sender1', null);
    expect(reactions).toEqual([{ emoji: '👍' }, { emoji: null }]);
  });

  it('emits disconnected events', () => {
    const reasons: string[] = [];
    bus.on('disconnected', (reason) => reasons.push(reason));
    bus.emit('disconnected', 'connection lost');
    expect(reasons).toEqual(['connection lost']);
  });
});
