#!/usr/bin/env node
import { McpServer, type ToolDefinition } from '../base-server.js';

class DatabaseServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'query_sqlite',
        description: 'Execute a SQL query against a SQLite database file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to SQLite database file' },
            query: { type: 'string', description: 'SQL query to execute' },
            params: { type: 'string', description: 'JSON array of query parameters (optional)' },
          },
          required: ['path', 'query'],
        },
      },
      {
        name: 'list_tables',
        description: 'List all tables in a SQLite database',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Path to SQLite database file' } },
          required: ['path'],
        },
      },
      {
        name: 'describe_table',
        description: 'Get schema information for a table',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to SQLite database file' },
            table: { type: 'string', description: 'Table name' },
          },
          required: ['path', 'table'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'query_sqlite': {
        const { default: Database } = await import('better-sqlite3');
        const dbPath = String(args['path']);
        const query = String(args['query']);
        const params: unknown[] = args['params'] ? JSON.parse(String(args['params'])) : [];
        const db = new Database(dbPath, { readonly: query.trim().toUpperCase().startsWith('SELECT') });
        try {
          if (query.trim().toUpperCase().startsWith('SELECT')) {
            const rows = db.prepare(query).all(...params);
            return { rows, count: rows.length };
          } else {
            const result = db.prepare(query).run(...params);
            return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
          }
        } finally {
          db.close();
        }
      }
      case 'list_tables': {
        const { default: Database } = await import('better-sqlite3');
        const dbPath = String(args['path']);
        const db = new Database(dbPath, { readonly: true });
        try {
          const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
          return { tables: rows.map((r) => r.name) };
        } finally {
          db.close();
        }
      }
      case 'describe_table': {
        const { default: Database } = await import('better-sqlite3');
        const dbPath = String(args['path']);
        const table = String(args['table']);
        const db = new Database(dbPath, { readonly: true });
        try {
          const columns = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
            cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
          }>;
          return {
            table,
            columns: columns.map((c) => ({
              name: c.name,
              type: c.type,
              nullable: !c.notnull,
              default: c.dflt_value,
              primaryKey: !!c.pk,
            })),
          };
        } finally {
          db.close();
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new DatabaseServer().start();
