#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { McpServer, type ToolDefinition } from '../base-server.js';

class TemplateServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'render_template',
        description: 'Render a template string with variable substitutions',
        inputSchema: {
          type: 'object',
          properties: {
            template: { type: 'string', description: 'Template string with {{variable}} placeholders' },
            variables: { type: 'string', description: 'JSON object of variable name-value pairs' },
          },
          required: ['template', 'variables'],
        },
      },
      {
        name: 'render_file',
        description: 'Render a template file with variable substitutions',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to template file' },
            variables: { type: 'string', description: 'JSON object of variable name-value pairs' },
          },
          required: ['path', 'variables'],
        },
      },
    ];
  }

  private render(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      if (key in variables) return variables[key]!;
      return `{{${key}}}`;
    });
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'render_template': {
        const template = String(args['template']);
        const variables = JSON.parse(String(args['variables'])) as Record<string, string>;
        const result = this.render(template, variables);
        return { result, variableCount: Object.keys(variables).length };
      }
      case 'render_file': {
        const path = resolve(String(args['path']));
        const variables = JSON.parse(String(args['variables'])) as Record<string, string>;
        const template = await readFile(path, 'utf-8');
        const result = this.render(template, variables);
        return { path, result, variableCount: Object.keys(variables).length };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new TemplateServer().start();
