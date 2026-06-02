import type { ChannelPlugin } from '../types.js';
import type { VisualUpdate } from '@agentx/shared';

interface WSClient {
  id: string;
  send(data: string): void;
}

export class WebSocketChannelPlugin implements ChannelPlugin {
  readonly id = 'websocket';
  readonly name = 'WebSocket Gateway';
  readonly version = '1.0.0';
  readonly description = 'WebSocket-based real-time channel for browsers and API clients';

  private clients = new Map<string, WSClient>();

  async onLoad(): Promise<void> {
    // No-op: server binding happens externally
  }

  async onStart(): Promise<void> {
    // Ready to accept connections
  }

  async onStop(): Promise<void> {
    for (const [id, client] of this.clients) {
      client.send(JSON.stringify({ type: 'gateway_stop' }));
      this.clients.delete(id);
    }
  }

  /** Register a WebSocket client connection */
  registerClient(clientId: string, send: (data: string) => void): void {
    this.clients.set(clientId, { id: clientId, send });
  }

  /** Deregister a WebSocket client */
  unregisterClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  async handleIncoming(payload: Record<string, unknown>): Promise<{ text: string; userId: string; channelId: string }> {
    const text = (payload['text'] as string) || '';
    const clientId = (payload['clientId'] as string) || 'anon';
    return { text, userId: clientId, channelId: clientId };
  }

  async handleOutgoing(text: string, metadata: Record<string, unknown>): Promise<Record<string, unknown>> {
    const clientId = (metadata['userId'] as string) || '';
    const client = this.clients.get(clientId);
    if (client) {
      client.send(JSON.stringify({ type: 'message', content: text, metadata }));
    }
    return { ok: true, text };
  }

  async handleVisualUpdate(update: VisualUpdate): Promise<Record<string, unknown> | null> {
    // Broadcast visual updates to all connected WS clients
    const payload = JSON.stringify({ type: 'visual_update', update });
    for (const [, client] of this.clients) {
      try {
        client.send(payload);
      } catch {
        // Client disconnected — will be cleaned up on next send
      }
    }
    return { broadcast: true, type: update.type };
  }

  broadcast(text: string): void {
    const payload = JSON.stringify({ type: 'broadcast', content: text });
    for (const [id, client] of this.clients) {
      try { client.send(payload); } catch { this.clients.delete(id); }
    }
  }

  isHealthy(): boolean {
    return true;
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
