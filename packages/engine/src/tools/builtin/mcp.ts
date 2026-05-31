import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { spawn } from 'node:child_process';

/**
 * MCP (Model Context Protocol) client tool.
 * Connects to MCP servers via stdio transport and calls tools.
 */

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

async function callMcpServer(
  server: McpServerConfig,
  method: string,
  params: Record<string, unknown>,
  timeout: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn(server.command, server.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...server.env },
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('MCP server timed out'));
    }, timeout);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`MCP server exited with code ${code}: ${stderr}`));
      } else {
        try {
          // Parse JSON-RPC response from stdout
          const lines = stdout.trim().split('\n');
          const lastLine = lines[lines.length - 1];
          const response = JSON.parse(lastLine!);
          resolve(response.result ?? response);
        } catch {
          resolve(stdout);
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // Send JSON-RPC request
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params,
    });
    proc.stdin.write(request + '\n');
    proc.stdin.end();
  });
}

export async function mcpCall(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const serverName = args['server'] as string;
  const method = args['method'] as string;
  const params = (args['params'] as Record<string, unknown>) ?? {};
  const command = args['command'] as string;
  const serverArgs = (args['args'] as string[]) ?? [];

  if (!method) {
    return { success: false, output: 'method is required', error: 'INVALID_ARGS' };
  }
  if (!command && !serverName) {
    return { success: false, output: 'command or server name is required', error: 'INVALID_ARGS' };
  }

  const server: McpServerConfig = {
    command: command ?? serverName,
    args: serverArgs,
  };

  try {
    const result = await callMcpServer(server, method, params, context.timeout);
    const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { success: true, output };
  } catch (error) {
    return { success: false, output: `MCP call failed: ${(error as Error).message}`, error: 'MCP_ERROR' };
  }
}

export async function mcpListTools(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  const serverArgs = (args['args'] as string[]) ?? [];

  if (!command) {
    return { success: false, output: 'command is required', error: 'INVALID_ARGS' };
  }

  const server: McpServerConfig = { command, args: serverArgs };

  try {
    const result = await callMcpServer(server, 'tools/list', {}, context.timeout);
    const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { success: true, output };
  } catch (error) {
    return { success: false, output: `MCP list-tools failed: ${(error as Error).message}`, error: 'MCP_ERROR' };
  }
}

export async function mcpServerConnect(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  const serverArgs = (args['args'] as string[]) ?? [];

  if (!command) {
    return { success: false, output: 'command is required', error: 'INVALID_ARGS' };
  }

  const server: McpServerConfig = { command, args: serverArgs };

  try {
    // Try to list tools first, then resources to show what's available
    const tools = await callMcpServer(server, 'tools/list', {}, context.timeout);
    const resources = await callMcpServer(server, 'resources/list', {}, context.timeout).catch(() => null);

    const parts: string[] = ['Connected to MCP server'];

    if (tools) {
      const toolsStr = typeof tools === 'string' ? tools : JSON.stringify(tools, null, 2);
      parts.push(`\nAvailable tools:\n${toolsStr}`);
    }
    if (resources) {
      const resStr = typeof resources === 'string' ? resources : JSON.stringify(resources, null, 2);
      parts.push(`\nAvailable resources:\n${resStr}`);
    }

    return { success: true, output: parts.join('\n') };
  } catch (error) {
    return { success: false, output: `Connection failed: ${(error as Error).message}`, error: 'MCP_ERROR' };
  }
}

export async function mcpResourceRead(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const command = args['command'] as string;
  const serverArgs = (args['args'] as string[]) ?? [];
  const uri = args['uri'] as string;

  if (!command || !uri) {
    return { success: false, output: 'command and uri are required', error: 'INVALID_ARGS' };
  }

  const server: McpServerConfig = { command, args: serverArgs };

  try {
    const result = await callMcpServer(server, 'resources/read', { uri }, context.timeout);
    const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    return { success: true, output };
  } catch (error) {
    return { success: false, output: `Resource read failed: ${(error as Error).message}`, error: 'MCP_ERROR' };
  }
}
