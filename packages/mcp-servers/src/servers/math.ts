#!/usr/bin/env node
import { McpServer, type ToolDefinition } from '../base-server.js';

class MathServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'calculate',
        description: 'Evaluate a mathematical expression',
        inputSchema: {
          type: 'object',
          properties: {
            expression: { type: 'string', description: 'Mathematical expression (e.g., 2 + 2, sqrt(16))' },
          },
          required: ['expression'],
        },
      },
      {
        name: 'convert_units',
        description: 'Convert between units (length, mass, temperature, etc.)',
        inputSchema: {
          type: 'object',
          properties: {
            value: { type: 'string', description: 'Numeric value to convert' },
            from: { type: 'string', description: 'Source unit (e.g., km, lb, celsius)' },
            to: { type: 'string', description: 'Target unit (e.g., mi, kg, fahrenheit)' },
          },
          required: ['value', 'from', 'to'],
        },
      },
      {
        name: 'random',
        description: 'Generate a random number',
        inputSchema: {
          type: 'object',
          properties: {
            min: { type: 'string', description: 'Minimum value (default: 0)' },
            max: { type: 'string', description: 'Maximum value (default: 100)' },
            integer: { type: 'string', description: 'Return integer if true (default: true)' },
          },
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'calculate': {
        const expression = String(args['expression']);
        // Safe math evaluation using Function constructor
        const sanitized = expression.replace(/[^0-9+\-*/.() ,sqrtpowabsfloorceilroundminmaxPIEsincostanlog exp]/g, '');
        const fn = new Function(`return (${sanitized})`);
        const result = fn();
        return { expression, result, type: typeof result };
      }
      case 'convert_units': {
        const value = parseFloat(String(args['value']));
        const from = String(args['from']).toLowerCase();
        const to = String(args['to']).toLowerCase();
        const conversions: Record<string, Record<string, number | ((v: number) => number)>> = {
          km: { mi: 0.621371, m: 1000, ft: 3280.84 },
          mi: { km: 1.60934, m: 1609.34, ft: 5280 },
          m: { km: 0.001, mi: 0.000621371, ft: 3.28084 },
          ft: { m: 0.3048, km: 0.0003048, mi: 0.000189394 },
          kg: { lb: 2.20462, g: 1000, oz: 35.274 },
          lb: { kg: 0.453592, g: 453.592, oz: 16 },
          g: { kg: 0.001, lb: 0.00220462, oz: 0.035274 },
          oz: { kg: 0.0283495, lb: 0.0625, g: 28.3495 },
          celsius: { fahrenheit: (v: number) => v * 9 / 5 + 32, kelvin: (v: number) => v + 273.15 },
          fahrenheit: { celsius: (v: number) => (v - 32) * 5 / 9, kelvin: (v: number) => (v - 32) * 5 / 9 + 273.15 },
          kelvin: { celsius: (v: number) => v - 273.15, fahrenheit: (v: number) => (v - 273.15) * 9 / 5 + 32 },
        };

        const unit = conversions[from];
        if (!unit) throw new Error(`Unknown unit: ${from}`);
        const conv = unit[to];
        if (conv === undefined) throw new Error(`Cannot convert from ${from} to ${to}`);

        const result = typeof conv === 'function' ? (conv as (v: number) => number)(value) : value * conv;
        return { value, from, to, result };
      }
      case 'random': {
        const min = parseFloat(String(args['min'] ?? '0'));
        const max = parseFloat(String(args['max'] ?? '100'));
        const integer = args['integer'] !== 'false';
        const raw = Math.random() * (max - min) + min;
        const result = integer ? Math.round(raw) : raw;
        return { result, min, max, integer };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new MathServer().start();
