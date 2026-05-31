#!/usr/bin/env node
import { McpServer, type ToolDefinition } from '../base-server.js';

class DateTimeServer extends McpServer {
  getTools(): ToolDefinition[] {
    return [
      {
        name: 'current_time',
        description: 'Get the current date and time',
        inputSchema: {
          type: 'object',
          properties: {
            timezone: { type: 'string', description: 'IANA timezone (e.g., UTC, America/New_York). Defaults to system timezone.' },
            format: { type: 'string', description: 'Output format: iso, unix, readable (default: iso)' },
          },
        },
      },
      {
        name: 'parse_date',
        description: 'Parse a date string and return its components',
        inputSchema: {
          type: 'object',
          properties: { input: { type: 'string', description: 'Date string to parse' } },
          required: ['input'],
        },
      },
      {
        name: 'format_date',
        description: 'Format a date with a custom pattern',
        inputSchema: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Date string or unix timestamp' },
            pattern: { type: 'string', description: 'Format pattern: YYYY-MM-DD, DD/MM/YYYY, etc.' },
          },
          required: ['input', 'pattern'],
        },
      },
      {
        name: 'date_diff',
        description: 'Calculate the difference between two dates',
        inputSchema: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'Start date string' },
            end: { type: 'string', description: 'End date string (default: now)' },
            unit: { type: 'string', description: 'Output unit: ms, seconds, minutes, hours, days, weeks (default: days)' },
          },
          required: ['start'],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'current_time': {
        const tz = args['timezone'] ? String(args['timezone']) : undefined;
        const format = String(args['format'] ?? 'iso');
        const now = new Date();
        const opts: Intl.DateTimeFormatOptions = tz ? { timeZone: tz } : {};

        switch (format) {
          case 'unix':
            return { timestamp: now.getTime(), unix: Math.floor(now.getTime() / 1000) };
          case 'readable':
            return { date: now.toLocaleDateString('en-US', opts), time: now.toLocaleTimeString('en-US', opts) };
          default:
            return { iso: now.toISOString(), timezone: tz ?? 'system' };
        }
      }
      case 'parse_date': {
        const input = String(args['input']);
        const d = new Date(input);
        if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
        return {
          input,
          valid: true,
          year: d.getFullYear(),
          month: d.getMonth() + 1,
          day: d.getDate(),
          hours: d.getHours(),
          minutes: d.getMinutes(),
          seconds: d.getSeconds(),
          weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
          iso: d.toISOString(),
          unix: Math.floor(d.getTime() / 1000),
        };
      }
      case 'format_date': {
        const input = String(args['input']);
        const pattern = String(args['pattern']);
        const d = new Date(input);
        if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`);
        const map: Record<string, string> = {
          YYYY: String(d.getFullYear()),
          MM: String(d.getMonth() + 1).padStart(2, '0'),
          DD: String(d.getDate()).padStart(2, '0'),
          HH: String(d.getHours()).padStart(2, '0'),
          mm: String(d.getMinutes()).padStart(2, '0'),
          ss: String(d.getSeconds()).padStart(2, '0'),
        };
        const formatted = pattern.replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => map[m] ?? m);
        return { input, pattern, result: formatted };
      }
      case 'date_diff': {
        const start = new Date(String(args['start']));
        if (isNaN(start.getTime())) throw new Error(`Invalid start date: ${args['start']}`);
        const end = args['end'] ? new Date(String(args['end'])) : new Date();
        if (isNaN(end.getTime())) throw new Error(`Invalid end date: ${args['end']}`);
        const unit = String(args['unit'] ?? 'days');
        const diffMs = end.getTime() - start.getTime();
        const units: Record<string, number> = {
          ms: 1,
          seconds: 1000,
          minutes: 60 * 1000,
          hours: 60 * 60 * 1000,
          days: 24 * 60 * 60 * 1000,
          weeks: 7 * 24 * 60 * 60 * 1000,
        };
        const divisor = units[unit];
        if (!divisor) throw new Error(`Unknown unit: ${unit}`);
        return {
          start: start.toISOString(),
          end: end.toISOString(),
          diff: diffMs / divisor,
          unit,
          absDiff: Math.abs(diffMs / divisor),
        };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}

new DateTimeServer().start();
