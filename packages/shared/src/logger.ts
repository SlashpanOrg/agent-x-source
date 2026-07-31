/**
 * Agent-X Structured Logger — writes JSON entries to file and optionally to console.
 * Location: ~/.local/share/agentx/logs/error.log
 * 
 * Features:
 * - JSON structured logging (file + console transport)
 * - Asynchronous file writes via internal queue (non-blocking)
 * - Console transport enabled by default in Docker/containers
 * - Log level filtering via AGENTX_LOG_LEVEL env var
 * - Automatic log rotation at 5MB (keeps 3 rotated files)
 * - Never throws or crashes the app over logging failures
 */
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getLogDir } from './utils/paths.js';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_ROTATED_FILES = 3;

export interface LogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  code: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Record handed to a registered {@link LogSink}. Mirrors {@link LogEntry} but
 * uses the observability-friendly field names (`scope`/`payload`) so the
 * Postgres log exporter can persist it directly. The sink is invoked from
 * within `Logger.write` after the level gate has passed, with the current
 * trace/span context captured by the sink itself (not the logger).
 */
export interface LogSinkRecord {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  /** The logger `code` (e.g. 'AI_SDK', 'TURN_JOURNEY'). */
  scope: string;
  message: string;
  payload?: Record<string, unknown>;
  stack?: string;
}

/**
 * A durable log sink — e.g. the observability {@code PostgresLogExporter}.
 * Sinks must never throw: the logger wraps each call in try/catch, but a sink
 * that fails repeatedly should back off on its own.
 */
export interface LogSink {
  log(record: LogSinkRecord): void;
}

const SINK_LEVEL_MAP: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Registered log sinks (e.g. the PostgresLogExporter). Fan-out is best-effort. */
const logSinks: LogSink[] = [];
/** Minimum level for a record to be forwarded to sinks (separate from console/file level). */
let sinkMinLevel: number = SINK_LEVEL_MAP[process.env['AGENTX_OBS_LOG_LEVEL'] ?? 'info'] ?? 1;

/**
 * Register a durable log sink. Every log call (that passes the sink level gate)
 * is fan-out delivered to each registered sink. Sink failures are swallowed.
 */
export function registerLogSink(sink: LogSink): void {
  if (!logSinks.includes(sink)) logSinks.push(sink);
  // Re-read the env in case it was set after module load.
  sinkMinLevel = SINK_LEVEL_MAP[process.env['AGENTX_OBS_LOG_LEVEL'] ?? 'info'] ?? 1;
}

/** Remove all registered log sinks (called on observability shutdown). */
export function clearLogSinks(): void {
  logSinks.length = 0;
}

/**
 * Durable ring buffer for log entries before they hit disk.
 * Prevents event-loop blocking by batching writes.
 */
class LogQueue {
  private buffer: LogEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
    // Flush every 500ms or when buffer reaches 50 entries
    this.timer = setInterval(() => this.flush(), 500);
    this.timer.unref();
  }

  push(entry: LogEntry): void {
    this.buffer.push(entry);
    if (this.buffer.length >= 50) {
      this.flush();
    }
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    try {
      this.rotateIfNeeded();
      const text = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
      appendFileSync(this.logPath, text);
    } catch {
      // Never crash the app over logging
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.logPath)) return;
    try {
      const stats = statSync(this.logPath);
      if (stats.size < MAX_LOG_SIZE) return;
      for (let i = MAX_ROTATED_FILES; i >= 1; i--) {
        const from = i === 1 ? this.logPath : `${this.logPath}.${i - 1}`;
        const to = `${this.logPath}.${i}`;
        if (i === MAX_ROTATED_FILES && existsSync(to)) unlinkSync(to);
        if (existsSync(from)) renameSync(from, to);
      }
    } catch { /* non-critical */ }
  }

  close(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}

export class Logger {
  private logPath: string;
  private consoleTransport: boolean;
  private minLevel: number;
  private queue: LogQueue;

  private static readonly LEVEL_MAP: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(logDir: string) {
    this.logPath = join(logDir, 'error.log');
    // Console transport: enabled by default in containers/development
    this.consoleTransport =
      process.env['AGENTX_LOG_CONSOLE'] !== '0' && (
        process.env['AGENTX_LOG_CONSOLE'] === '1' ||
        process.env['NODE_ENV'] === 'development' ||
        !process.env['NODE_ENV']
      );
    this.minLevel = Logger.LEVEL_MAP[process.env['AGENTX_LOG_LEVEL'] || 'info'] ?? 1;
    mkdirSync(logDir, { recursive: true });
    this.queue = new LogQueue(this.logPath);
  }

  private shouldLog(level: string): boolean {
    return (Logger.LEVEL_MAP[level] ?? 0) >= this.minLevel;
  }

  private write(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    // Queue for async file write (non-blocking)
    this.queue.push(entry);

    // Console transport: structured JSON to stdout/stderr
    if (this.consoleTransport) {
      const stream = entry.level === 'error' ? process.stderr : process.stdout;
      try {
        stream.write(JSON.stringify(entry) + '\n');
      } catch {
        // Best-effort
      }
    }

    // Fan-out to registered durable sinks (e.g. PostgresLogExporter).
    // The sink level gate is independent of the console/file level so that
    // `AGENTX_OBS_LOG_LEVEL=warn` can suppress info/debug persistence without
    // silencing the console. A sink failure never breaks logging.
    if (logSinks.length > 0 && (SINK_LEVEL_MAP[entry.level] ?? 0) >= sinkMinLevel) {
      const record: LogSinkRecord = {
        timestamp: entry.timestamp,
        level: entry.level,
        scope: entry.code,
        message: entry.message,
        payload: entry.context,
        stack: entry.stack,
      };
      for (const sink of logSinks) {
        try {
          sink.log(record);
        } catch {
          // A sink must never crash the app over logging.
        }
      }
    }
  }

  error(code: string, error: unknown, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'error',
      code,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context,
    });
  }

  warn(code: string, message: string, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'warn',
      code,
      message,
      context,
    });
  }

  info(code: string, message: string, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'info',
      code,
      message,
      context,
    });
  }

  debug(code: string, message: string, context?: Record<string, unknown>): void {
    this.write({
      timestamp: new Date().toISOString(),
      level: 'debug',
      code,
      message,
      context,
    });
  }

  /**
   * Flush pending log entries to disk.
   * Call during graceful shutdown to ensure no data loss.
   */
  flush(): void {
    this.queue.close();
  }
}

/** Singleton logger instance — lazily initialized */
let _logger: Logger | null = null;

export function getLogger(logDir?: string): Logger {
  if (!_logger) {
    const dir = logDir ?? getDefaultLogDir();
    _logger = new Logger(dir);
  }
  return _logger;
}

/**
 * Flush and reset the logger singleton.
 * Primarily used during graceful shutdown.
 */
export function closeLogger(): void {
  if (_logger) {
    _logger.flush();
    _logger = null;
  }
}

function getDefaultLogDir(): string {
  return getLogDir();
}
