#!/usr/bin/env node
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { McpServer, type ToolDefinition } from '../base-server.js';

const execAsync = promisify(exec);

class ShellServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'run_command',
        description: 'Execute a shell command and return its output',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
            timeout: { type: 'string', description: 'Timeout in milliseconds (default: 30000)' },
            cwd: { type: 'string', description: 'Working directory (default: cwd)' },
          },
          required: ['command'],
        },
      },
      {
        name: 'which',
        description: 'Check if a program is available in PATH',
        inputSchema: {
          type: 'object',
          properties: { program: { type: 'string', description: 'Program name to check' } },
          required: ['program'],
        },
      },
      {
        name: 'env_var',
        description: 'Get the value of an environment variable',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string', description: 'Environment variable name' } },
          required: ['name'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'run_command': {
        const command = String(args['command']);
        const timeout = parseInt(String(args['timeout'] ?? '30000'), 10);
        const cwd = args['cwd'] ? String(args['cwd']) : process.cwd();

        try {
          const { stdout, stderr } = await execAsync(command, {
            timeout,
            cwd,
            maxBuffer: 10 * 1024 * 1024,
            env: process.env,
          });
          return { stdout, stderr, exitCode: 0 };
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; code?: number; message: string };
          return {
            stdout: e.stdout ?? '',
            stderr: e.stderr ?? e.message,
            exitCode: e.code ?? 1,
          };
        }
      }
      case 'which': {
        const program = String(args['program']);
        try {
          execSync(`which "${program}"`, { encoding: 'utf-8' });
          return { available: true, program };
        } catch {
          return { available: false, program };
        }
      }
      case 'env_var': {
        const name = String(args['name']);
        return { name, value: process.env[name] ?? null };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new ShellServer().start();
