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

export interface ACPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ACPHandlers {
  listTools?: () => ACPToolDefinition[];
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  delegateTask?: (task: string) => Promise<{ output: string }>;
  getStatus?: () => Record<string, unknown>;
}

export class ACPServer {
  private handlers: ACPHandlers = {};
  private rl: ReturnType<typeof createInterface> | null = null;
  private running = false;

  setHandlers(handlers: ACPHandlers): void {
    this.handlers = handlers;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

    this.rl.on('line', (line: string) => {
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line);
      } catch {
        return;
      }

      if (request.jsonrpc !== '2.0' || request.id == null) return;

      this.handleRequest(request).then((response) => {
        process.stdout.write(JSON.stringify(response) + '\n');
      });
    });
  }

  stop(): void {
    this.running = false;
    this.rl?.close();
    this.rl = null;
  }

  private async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const base: JsonRpcResponse = { jsonrpc: '2.0', id: req.id };

    try {
      switch (req.method) {
        case 'acp/initialize':
          return { ...base, result: { protocol: 'acp', version: '1.0', capabilities: ['tools', 'agent_delegation'] } };

        case 'acp/shutdown':
          this.stop();
          return { ...base, result: { status: 'shutdown' } };

        case 'acp/status': {
          const status = this.handlers.getStatus?.() ?? {};
          return { ...base, result: { running: this.running, ...status } };
        }

        case 'acp/tools/list': {
          const tools = this.handlers.listTools?.() ?? [];
          return { ...base, result: tools };
        }

        case 'acp/tools/call':
          return this.handleToolCall(base, req.params);

        case 'acp/agent/delegate':
          return this.handleDelegation(base, req.params);

        default:
          return { ...base, error: { code: -32601, message: `Method not found: ${req.method}` } };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ...base, error: { code: -32603, message: msg } };
    }
  }

  private async handleToolCall(base: JsonRpcResponse, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    if (!this.handlers.executeTool) {
      return { ...base, error: { code: -32000, message: 'Tool execution not supported' } };
    }
    const name = params?.name as string | undefined;
    const args = params?.arguments as Record<string, unknown> | undefined;
    if (!name) return { ...base, error: { code: -32602, message: 'Missing tool name' } };

    try {
      const result = await this.handlers.executeTool(name, args ?? {});
      return { ...base, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ...base, error: { code: -32000, message: msg } };
    }
  }

  private async handleDelegation(base: JsonRpcResponse, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    if (!this.handlers.delegateTask) {
      return { ...base, error: { code: -32000, message: 'Agent delegation not supported' } };
    }
    const task = params?.task as string | undefined;
    if (!task) return { ...base, error: { code: -32602, message: 'Missing task' } };

    try {
      const result = await this.handlers.delegateTask(task);
      return { ...base, result };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ...base, error: { code: -32000, message: msg } };
    }
  }
}
