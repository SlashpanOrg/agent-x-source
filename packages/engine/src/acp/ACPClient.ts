import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface ACPConnectionConfig {
  command?: string;
  args?: string[];
  host?: string;
  port?: number;
}

export interface ACPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class ACPClient {
  private config: ACPConnectionConfig;
  private proc: ChildProcess | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private requestId = 0;
  private pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map();
  private connected = false;

  constructor(config: ACPConnectionConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (this.config.command) {
      await this.connectStdio();
    } else if (this.config.host && this.config.port) {
      await this.connectTcp();
    } else {
      throw new Error('ACPClient requires either command+args or host+port');
    }

    await this.request('acp/initialize', {});
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    try {
      await this.request('acp/shutdown', {});
    } catch { /* ignore */ }
    this.proc?.kill();
    this.rl?.close();
    this.proc = null;
    this.rl = null;
    this.connected = false;
  }

  async listTools(): Promise<ACPToolDefinition[]> {
    return (await this.request('acp/tools/list', {})) as ACPToolDefinition[];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.request('acp/tools/call', { name, arguments: args });
  }

  async delegateTask(task: string): Promise<{ output: string }> {
    return (await this.request('acp/agent/delegate', { task })) as { output: string };
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async connectStdio(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.config.command!, this.config.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.rl = createInterface({ input: this.proc.stdout!, terminal: false });

      this.rl.on('line', (line: string) => {
        let response: JsonRpcResponse;
        try {
          response = JSON.parse(line);
        } catch {
          return;
        }
        if (response.id == null) return;
        const pending = this.pending.get(response.id);
        if (pending) {
          this.pending.delete(response.id);
          if (response.error) {
            pending.reject(new Error(response.error.message));
          } else {
            pending.resolve(response.result);
          }
        }
      });

      this.proc.on('error', reject);
      this.proc.on('spawn', resolve);
    });
  }

  private async connectTcp(): Promise<void> {
    const { connect } = await import('node:net');
    return new Promise((resolve, reject) => {
      const socket = connect(this.config.port!, this.config.host!, () => {
        this.rl = createInterface({ input: socket, terminal: false });
        this.rl.on('line', (line: string) => {
          let response: JsonRpcResponse;
          try {
            response = JSON.parse(line);
          } catch {
            return;
          }
          if (response.id == null) return;
          const pending = this.pending.get(response.id);
          if (pending) {
            this.pending.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        });
        resolve();
      });
      socket.on('error', reject);
    });
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.proc && !this.connected) {
      throw new Error('ACPClient not connected');
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const target = this.config.command ? this.proc?.stdin : null;
      if (target) {
        target.write(JSON.stringify(request) + '\n');
      }
    });
  }
}
