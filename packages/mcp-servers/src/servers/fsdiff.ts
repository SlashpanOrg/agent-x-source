#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { McpServer, type ToolDefinition } from '../base-server.js';

class FsDiffServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'diff_files',
        description: 'Show diff between two files',
        inputSchema: {
          type: 'object',
          properties: {
            file1: { type: 'string', description: 'Path to first file' },
            file2: { type: 'string', description: 'Path to second file' },
            context: { type: 'string', description: 'Context lines (default: 3)' },
          },
          required: ['file1', 'file2'],
        },
      },
      {
        name: 'apply_patch',
        description: 'Apply a unified diff patch to a file',
        inputSchema: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Path to the target file' },
            patch: { type: 'string', description: 'Unified diff patch content' },
            dryRun: { type: 'string', description: 'Preview changes without applying (default: true)' },
          },
          required: ['target', 'patch'],
        },
      },
      {
        name: 'create_patch',
        description: 'Create a unified diff from changes between two strings',
        inputSchema: {
          type: 'object',
          properties: {
            original: { type: 'string', description: 'Original content' },
            modified: { type: 'string', description: 'Modified content' },
            context: { type: 'string', description: 'Context lines (default: 3)' },
          },
          required: ['original', 'modified'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'diff_files': {
        const file1 = resolve(String(args['file1']));
        const file2 = resolve(String(args['file2']));
        const context = String(args['context'] ?? '3');
        await readFile(file1, 'utf-8');
        await readFile(file2, 'utf-8');
        try {
          const diff = execSync(
            `diff -u -U${context} "${file1}" "${file2}"`,
            { encoding: 'utf-8' }
          );
          return { diff, files: { [file1]: 'a', [file2]: 'b' }, hasChanges: true };
        } catch (e) {
          const out = (e as { stdout?: string }).stdout ?? '';
          return { diff: out, files: { [file1]: 'a', [file2]: 'b' }, hasChanges: true };
        }
      }
      case 'apply_patch': {
        const target = resolve(String(args['target']));
        const patch = String(args['patch']);
        const dryRun = args['dryRun'] !== 'false';

        if (dryRun) {
          const result = execSync(`patch --dry-run "${target}"`, {
            input: patch,
            encoding: 'utf-8',
          });
          return { dryRun: true, result: result.trim() };
        }

        const result = execSync(`patch "${target}"`, {
          input: patch,
          encoding: 'utf-8',
        });
        return { dryRun: false, result: result.trim() };
      }
      case 'create_patch': {
        const original = String(args['original']);
        const modified = String(args['modified']);
        const context = String(args['context'] ?? '3');

        const tmpOriginal = `/tmp/__mcp_diff_original_${Date.now()}`;
        const tmpModified = `/tmp/__mcp_diff_modified_${Date.now()}`;
        await writeFile(tmpOriginal, original, 'utf-8');
        await writeFile(tmpModified, modified, 'utf-8');

        try {
          const diff = execSync(
            `diff -u -U${context} "${tmpOriginal}" "${tmpModified}"`,
            { encoding: 'utf-8' }
          );
          return { diff, hasChanges: !!diff };
        } catch (e) {
          const out = (e as { stdout?: string }).stdout ?? '';
          return { diff: out, hasChanges: true };
        } finally {
          execSync(`rm -f "${tmpOriginal}" "${tmpModified}"`);
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new FsDiffServer().start();
