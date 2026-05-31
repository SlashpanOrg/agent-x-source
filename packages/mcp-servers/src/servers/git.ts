#!/usr/bin/env node
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { McpServer, type ToolDefinition } from '../base-server.js';

const execAsync = promisify(exec);

class GitServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'git_status',
        description: 'Show working tree status',
        inputSchema: {
          type: 'object',
          properties: { cwd: { type: 'string', description: 'Repository path (default: cwd)' } },
        },
      },
      {
        name: 'git_log',
        description: 'Show commit log',
        inputSchema: {
          type: 'object',
          properties: {
            cwd: { type: 'string', description: 'Repository path (default: cwd)' },
            count: { type: 'string', description: 'Number of commits (default: 10)' },
            branch: { type: 'string', description: 'Branch name (default: current branch)' },
          },
        },
      },
      {
        name: 'git_diff',
        description: 'Show uncommitted changes',
        inputSchema: {
          type: 'object',
          properties: {
            cwd: { type: 'string', description: 'Repository path (default: cwd)' },
            staged: { type: 'string', description: 'Show staged diff if true (default: false)' },
            path: { type: 'string', description: 'Specific file path to diff (optional)' },
          },
        },
      },
      {
        name: 'git_branches',
        description: 'List branches',
        inputSchema: {
          type: 'object',
          properties: {
            cwd: { type: 'string', description: 'Repository path (default: cwd)' },
            all: { type: 'string', description: 'Include remote branches if true (default: false)' },
          },
        },
      },
      {
        name: 'git_commit',
        description: 'Create a commit',
        inputSchema: {
          type: 'object',
          properties: {
            cwd: { type: 'string', description: 'Repository path (default: cwd)' },
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['message'],
        },
      },
    ];
  }

  private async git(args: string[], cwd?: string): Promise<string> {
    const opts: Record<string, unknown> = {};
    if (cwd) opts['cwd'] = cwd;
    const { stdout } = await execAsync(`git ${args.join(' ')}`, opts as { cwd?: string });
    return stdout.trim();
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const cwd = args['cwd'] ? String(args['cwd']) : process.cwd();
    switch (name) {
      case 'git_status': {
        const status = await this.git(['status', '--short'], cwd);
        const branch = await this.git(['branch', '--show-current'], cwd);
        return { branch, status: status ? status.split('\n') : [], clean: !status };
      }
      case 'git_log': {
        const count = String(args['count'] ?? '10');
        const branch = args['branch'] ? String(args['branch']) : '';
        const ref = branch || 'HEAD';
        const log = await this.git(['log', `--max-count=${count}`, ref, '--format=%H|%an|%ai|%s'], cwd);
        const commits = log.split('\n').filter(Boolean).map((line) => {
          const [hash, author, date, ...rest] = line.split('|');
          return { hash, author, date, message: rest.join('|') };
        });
        return { commits, count: commits.length };
      }
      case 'git_diff': {
        const staged = args['staged'] === 'true';
        const diffArgs = ['diff'];
        if (staged) diffArgs.push('--staged');
        if (args['path']) diffArgs.push('--', String(args['path']));
        const diff = await this.git(diffArgs, cwd);
        return { diff, hasChanges: !!diff };
      }
      case 'git_branches': {
        const all = args['all'] === 'true';
        const branchList = await this.git(['branch', ...(all ? ['-a'] : [])], cwd);
        const branches = branchList.split('\n').filter(Boolean).map((b) => ({
          name: b.replace('*', '').trim(),
          current: b.startsWith('*'),
        }));
        return { branches };
      }
      case 'git_commit': {
        const message = String(args['message']);
        await this.git(['commit', '-m', `"${message.replace(/"/g, '\\"')}"`], cwd);
        const hash = await this.git(['rev-parse', 'HEAD'], cwd);
        return { success: true, hash, message };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new GitServer().start();
