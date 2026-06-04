import type { ChannelPlugin } from '../types.js';
import type { FocusState } from '../FocusManager.js';
import type { VisualUpdate } from '@agentx/shared';

interface WSClient {
  id: string;
  send(data: string): void;
  metadata?: Record<string, unknown>;
}

export class WebSocketChannelPlugin implements ChannelPlugin {
  readonly id = 'websocket';
  readonly name = 'WebSocket Gateway';
  readonly version = '2.0.0';
  readonly description = 'WebSocket-based real-time channel for browsers and API clients';

  private clients = new Map<string, WSClient>();
  private active = false;

  async onLoad(): Promise<void> {}

  async onStart(): Promise<void> {
    this.active = true;
  }

  async onStop(): Promise<void> {
    for (const [id, client] of this.clients) {
      client.send(JSON.stringify({ type: 'gateway_stop' }));
      this.clients.delete(id);
    }
    this.active = false;
  }

  /** Register a WebSocket client connection */
  registerClient(clientId: string, send: (data: string) => void, metadata?: Record<string, unknown>): void {
    this.clients.set(clientId, { id: clientId, send, metadata });
  }

  /** Deregister a WebSocket client */
  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  /** Broadcast a message to all connected clients */
  broadcast(data: Record<string, unknown>): void {
    const payload = JSON.stringify({ ...data, channel: 'websocket' });
    for (const [id, client] of this.clients) {
      try { client.send(payload); } catch { this.clients.delete(id); }
    }
  }

  async handleIncoming(payload: Record<string, unknown>): Promise<{ text: string; userId: string; channelId: string }> {
    const text = (payload['text'] as string) || '';
    const clientId = (payload['clientId'] as string) || 'anon';
    const sessionId = (payload['sessionId'] as string) || clientId;
    return { text, userId: clientId, channelId: sessionId };
  }

  async handleOutgoing(text: string, metadata: Record<string, unknown>): Promise<Record<string, unknown>> {
    const clientId = (metadata['userId'] as string) || '';
    const client = this.clients.get(clientId);
    if (client) {
      client.send(JSON.stringify({ type: 'message', content: text, metadata, channel: 'websocket' }));
    }
    return { ok: true, text };
  }

  async handleVisualUpdate(update: VisualUpdate): Promise<Record<string, unknown> | null> {
    const payload = JSON.stringify({ type: 'visual_update', update, channel: 'websocket' });
    for (const [, client] of this.clients) {
      try {
        client.send(payload);
      } catch {
        // Client disconnected
      }
    }
    return { broadcast: true, type: update.type };
  }

  getFocusState(): FocusState {
    return this.active && this.clients.size > 0 ? 'focused' : 'away';
  }

  isHealthy(): boolean {
    return this.active;
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
