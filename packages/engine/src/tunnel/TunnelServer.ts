import { getLogger } from '@agentx/shared';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';

const logger = getLogger();

export interface TunnelConfig {
  host?: string;
  port?: number;
  authToken?: string;
  tlsCert?: string;
  tlsKey?: string;
}

export interface TunnelSession {
  id: string;
  clientId: string;
  connectedAt: number;
  peerUrl: string;
}

// ── Tunnel Server ──

export class TunnelServer {
  private server: Server | null = null;
  private sessions: Map<string, TunnelSession> = new Map();
  private config: Required<TunnelConfig>;

  constructor(config?: TunnelConfig) {
    this.config = {
      host: config?.host ?? '0.0.0.0',
      port: config?.port ?? 8080,
      authToken: config?.authToken ?? randomBytes(32).toString('hex'),
      tlsCert: config?.tlsCert ?? '',
      tlsKey: config?.tlsKey ?? '',
    };
  }

  getSessions(): TunnelSession[] {
    return [...this.sessions.values()];
  }

  getConfig(): Required<TunnelConfig> {
    return { ...this.config };
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { WebSocketServer } = require('ws');
      let opts: Record<string, unknown> = {};

      if (this.config.tlsCert && this.config.tlsKey) {
        const https = require('node:https');
        opts = {
          cert: readFileSync(this.config.tlsCert),
          key: readFileSync(this.config.tlsKey),
        };
      }

      this.server = createServer(opts);

      const wss = new WebSocketServer({ server: this.server });
      const authToken = this.config.authToken;

      wss.on('connection', (ws: WebSocket, req: import('node:http').IncomingMessage) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        const token = url.searchParams.get('token');

        if (token !== authToken) {
          ws.close(4001, 'Unauthorized');
          return;
        }

        const sessionId = `tun_${Date.now()}_${randomBytes(4).toString('hex')}`;
        const clientId = url.searchParams.get('clientId') ?? 'unknown';

        const session: TunnelSession = {
          id: sessionId,
          clientId,
          connectedAt: Date.now(),
          peerUrl: `ws://${this.config.host}:${this.config.port}/session/${sessionId}?token=${authToken}`,
        };

        this.sessions.set(sessionId, session);
        logger.info('TUNNEL_CLIENT_CONNECTED', { sessionId, clientId });

        ws.on('message', (data: Buffer) => {
          // Relay to all peers in same session group
          this.broadcast(sessionId, data);
        });

        ws.on('close', () => {
          this.sessions.delete(sessionId);
          logger.info('TUNNEL_CLIENT_DISCONNECTED', { sessionId });
        });

        // Send session ID to client
        ws.send(JSON.stringify({ type: 'session_created', sessionId }), () => {
          /* ignore */
        });
      });

      this.server.listen(this.config.port, this.config.host, () => {
        logger.info('TUNNEL_SERVER_STARTED', { host: this.config.host, port: this.config.port });
        resolve();
      });

      this.server.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.sessions.clear();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private broadcast(sessionId: string, data: Buffer): void {
    const { WebSocket } = require('ws');
    this.server?.emit('data', { sessionId, data });
  }

  getUrl(): string {
    const proto = this.config.tlsCert ? 'wss' : 'ws';
    return `${proto}://${this.config.host}:${this.config.port}`;
  }
}

// ── Tunnel Client ──

export class TunnelClient {
  private ws: WebSocket | null = null;
  private config: { url: string; token: string; clientId: string };
  private onMessage: ((data: string) => void) | null = null;
  private onConnected: ((sessionId: string) => void) | null = null;
  private onDisconnected: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string = '';

  constructor(config: { url: string; token?: string; clientId?: string }) {
    this.config = {
      url: config.url,
      token: config.token ?? '',
      clientId: config.clientId ?? `client_${randomBytes(4).toString('hex')}`,
    };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  setOnMessage(cb: (data: string) => void): void {
    this.onMessage = cb;
  }

  setOnConnected(cb: (sessionId: string) => void): void {
    this.onConnected = cb;
  }

  setOnDisconnected(cb: () => void): void {
    this.onDisconnected = cb;
  }

  async connect(): Promise<void> {
    const { WebSocket } = await import('ws');

    const params = new URLSearchParams({
      token: this.config.token,
      clientId: this.config.clientId,
    });

    const url = `${this.config.url}?${params}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
          logger.info('TUNNEL_CLIENT_CONNECTED', { url: this.config.url });
          resolve();
        });

        this.ws.on('message', (data: Buffer) => {
          const text = data.toString();
          try {
            const msg = JSON.parse(text);
            if (msg.type === 'session_created') {
              this.sessionId = msg.sessionId;
              this.onConnected?.(msg.sessionId);
            }
          } catch { /* plain text */ }
          this.onMessage?.(text);
        });

        this.ws.on('close', () => {
          this.ws = null;
          this.onDisconnected?.();
          this.scheduleReconnect();
        });

        this.ws.on('error', (err: Error) => {
          logger.error('TUNNEL_CLIENT_ERROR', err.message);
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  send(data: string): void {
    if (this.ws) {
      this.ws.send(data, () => { /* ignore */ });
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.ws !== null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      logger.info('TUNNEL_CLIENT_RECONNECT', 'Attempting reconnection...');
      this.connect().catch(() => { /* will retry */ });
    }, 5000);
  }
}
