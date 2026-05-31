import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export abstract class McpServer {
  abstract getTools(): ToolDefinition[];
  abstract executeTool(name: string, args: Record<string, unknown>): Promise<unknown>;

  start(): void {
    const rl = createInterface({ input: stdin });
    let buffer = '';

    rl.on('line', (line) => {
      buffer += line;
      try {
        const request = JSON.parse(buffer);
        buffer = '';
        this.handleRequest(request).catch((err) => {
          this.sendError(request.id, -32603, `Internal error: ${err.message}`);
        });
      } catch {
        // incomplete JSON — wait for more input
      }
    });

    rl.on('close', () => {
      process.exit(0);
    });
  }

  private async handleRequest(request: { jsonrpc: string; id: number; method: string; params?: Record<string, unknown> }): Promise<void> {
    const { id, method, params = {} } = request;

    switch (method) {
      case 'tools/list': {
        this.sendResult(id, { tools: this.getTools() });
        break;
      }
      case 'tools/call': {
        const name = params['name'] as string;
        const args = params['arguments'] as Record<string, unknown> ?? {};
        try {
          const result = await this.executeTool(name, args);
          this.sendResult(id, result);
        } catch (err) {
          this.sendError(id, -32000, (err as Error).message);
        }
        break;
      }
      default:
        this.sendError(id, -32601, `Method not found: ${method}`);
    }
  }

  private sendResult(id: number, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  private sendError(id: number, code: number, message: string, data?: unknown): void {
    this.write({ jsonrpc: '2.0', id, error: { code, message, data } });
  }

  private write(msg: unknown): void {
    stdout.write(JSON.stringify(msg) + '\n');
  }
}
