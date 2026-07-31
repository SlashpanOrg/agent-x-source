/**
 * WhatsAppEventBus — single fan-out point for all WhatsApp engine events.
 *
 * Per §3.6 of WHATSAPP_INTEGRATION_PLAN.md, every engine callback (`onMessage`,
 * `onMessageAck`, `onStateChanged`, `onQRCode`, `onDisconnected`, group/call
 * events, etc.) emits through this bus. No consumer (agent live-listening path,
 * webhook subsystem, dashboard) should ever read directly off the engine
 * instance — they all subscribe here.
 *
 * This is a typed EventEmitter-style bus, not a queue. Events are delivered
 * synchronously to all subscribers; subscribers are responsible for their own
 * async work (e.g. enqueuing to pg-boss for webhooks).
 *
 * Written from scratch for Agent-X — not copied from any reference project.
 */
import { EventEmitter } from 'node:events';
import type {
  WhatsAppIncomingMessage,
  WhatsAppMessageAck,
  WhatsAppCallEvent,
  WhatsAppGroupEvent,
  EngineStatus,
  EngineReadyInfo,
} from './engine/IWhatsAppEngine.js';

/** All events emitted by the WhatsAppEventBus. */
export type WhatsAppEvent =
  | 'message'
  | 'messageSent'
  | 'messageAck'
  | 'messageEdited'
  | 'messageRevoked'
  | 'messageReaction'
  | 'callReceived'
  | 'groupEvent'
  | 'stateChanged'
  | 'qrCode'
  | 'pairingCode'
  | 'disconnected'
  | 'error';

/** Typed event map for the bus. */
export interface WhatsAppEventMap {
  message: [msg: WhatsAppIncomingMessage];
  messageSent: [msg: WhatsAppIncomingMessage];
  messageAck: [ack: WhatsAppMessageAck];
  messageEdited: [msg: WhatsAppIncomingMessage];
  messageRevoked: [chatId: string, messageId: string];
  messageReaction: [chatId: string, messageId: string, senderId: string, emoji: string | null];
  callReceived: [call: WhatsAppCallEvent];
  groupEvent: [event: WhatsAppGroupEvent];
  stateChanged: [status: EngineStatus, info?: EngineReadyInfo];
  qrCode: [qrDataUrl: string];
  pairingCode: [code: string];
  disconnected: [reason: string];
  error: [error: Error];
}

/**
 * Typed event bus for WhatsApp events. Wraps Node's `EventEmitter` with
 * strict event-name / argument typing.
 */
export class WhatsAppEventBus extends EventEmitter {
  constructor() {
    super();
    // Allow many subscribers without the MaxListeners warning.
    this.setMaxListeners(50);
  }

  on<K extends WhatsAppEvent>(event: K, listener: (...args: WhatsAppEventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<K extends WhatsAppEvent>(event: K, listener: (...args: WhatsAppEventMap[K]) => void): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  off<K extends WhatsAppEvent>(event: K, listener: (...args: WhatsAppEventMap[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends WhatsAppEvent>(event: K, ...args: WhatsAppEventMap[K]): boolean {
    return super.emit(event, ...args);
  }

  /** Remove all listeners for a specific event (or all events). */
  clear(event?: WhatsAppEvent): void {
    if (event) {
      this.removeAllListeners(event);
    } else {
      this.removeAllListeners();
    }
  }
}
