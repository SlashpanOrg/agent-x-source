#!/usr/bin/env node
import { access, constants, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { homedir } from 'node:os';
import { McpServer, type ToolDefinition } from '../base-server.js';

const ALLOWED_PATHS = [process.cwd(), homedir()];

function isPathAllowed(target: string): boolean {
  const resolved = resolve(target);
  return ALLOWED_PATHS.some((p) => resolved.startsWith(p));
}

class FileSystemServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'read_file',
        description: 'Read contents of a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute path to the file' } },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file (creates directories if needed)',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path to the file' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_dir',
        description: 'List entries in a directory',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute path to the directory' } },
          required: ['path'],
        },
      },
      {
        name: 'file_info',
        description: 'Get metadata about a file or directory',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute path' } },
          required: ['path'],
        },
      },
      {
        name: 'delete_file',
        description: 'Delete a file',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute path to the file' } },
          required: ['path'],
        },
      },
      {
        name: 'create_dir',
        description: 'Create a directory (recursive)',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute path to the directory' } },
          required: ['path'],
        },
      },
      {
        name: 'glob',
        description: 'Find files matching a glob pattern',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g., **/*.ts)' },
            root: { type: 'string', description: 'Root directory to search from (default: cwd)' },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'search_files',
        description: 'Search file contents for a regex pattern',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Regex pattern to search for' },
            root: { type: 'string', description: 'Root directory to search (default: cwd)' },
            include: { type: 'string', description: 'File glob pattern to include (e.g., *.ts)' },
          },
          required: ['pattern'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'read_file': {
        const p = resolve(String(args['path']));
        if (!isPathAllowed(p)) throw new Error(`Access denied: ${p} is outside allowed paths`);
        const content = await readFile(p, 'utf-8');
        const st = await stat(p);
        return { content, size: st.size, lines: content.split('\n').length };
      }
      case 'write_file': {
        const p = resolve(String(args['path']));
        if (!isPathAllowed(p)) throw new Error(`Access denied: ${p} is outside allowed paths`);
        await mkdir(resolve(p, '..'), { recursive: true });
        await writeFile(p, String(args['content']), 'utf-8');
        return { success: true, path: p };
      }
      case 'list_dir': {
        const p = resolve(String(args['path']));
        if (!isPathAllowed(p)) throw new Error(`Access denied`);
        const entries = await readdir(p, { withFileTypes: true });
        return {
          entries: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'directory' : 'file',
            path: join(p, e.name),
          })),
        };
      }
      case 'file_info': {
        const p = resolve(String(args['path']));
        if (!isPathAllowed(p)) throw new Error(`Access denied`);
        const st = await stat(p);
        return {
          path: p,
          size: st.size,
          isDirectory: st.isDirectory(),
          isFile: st.isFile(),
          isSymlink: st.isSymbolicLink(),
          created: st.birthtime,
          modified: st.mtime,
          mode: st.mode.toString(8),
        };
      }
      case 'delete_file': {
        const p = resolve(String(args['path']));
        if (!isPathAllowed(p)) throw new Error(`Access denied`);
        await unlink(p);
        return { success: true, path: p };
      }
      case 'create_dir': {
        const p = resolve(String(args['path']));
        if (!isPathAllowed(p)) throw new Error(`Access denied`);
        await mkdir(p, { recursive: true });
        return { success: true, path: p };
      }
      case 'glob': {
        const { Glob } = await import('glob');
        const pattern = String(args['pattern']);
        const root = args['root'] ? resolve(String(args['root'])) : process.cwd();
        const files = await Glob(pattern, { cwd: root, nodir: true });
        return { files: files.map((f) => join(root, f)) };
      }
      case 'search_files': {
        const { execSync } = await import('node:child_process');
        const pattern = String(args['pattern']);
        const root = args['root'] ? String(args['root']) : process.cwd();
        const include = args['include'] ? `--include="${args['include']}"` : '';
        try {
          const output = execSync(`rg --line-number --color=never ${include} "${pattern}" "${root}"`, {
            encoding: 'utf-8',
            maxBuffer: 1024 * 1024,
          });
          const lines = output.trim().split('\n').filter(Boolean);
          const results = lines.map((l) => {
            const [file, line, ...rest] = l.split(':');
            return { file, line: parseInt(line!, 10), content: rest.join(':') };
          });
          return { results, count: results.length };
        } catch {
          return { results: [], count: 0 };
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new FileSystemServer().start();
