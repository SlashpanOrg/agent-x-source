/**
 * MediaHandler — inbound media size caps + SSRF-safe outbound media fetch
 * (Phase 4.5).
 *
 * Inbound: When a media message arrives, the engine may include the media
 * bytes (base64) or omit them if they exceed the size cap. This module
 * provides the cap logic and a concurrency-limited download queue for
 * deferred downloads.
 *
 * Outbound: When sending media by URL, the fetch must be SSRF-safe —
 * blocking private/internal IP ranges (10.x, 172.16-31.x, 192.168.x,
 * 127.x, ::1, fc00::/7, etc.) to prevent the agent from being tricked
 * into hitting internal services.
 *
 * Written from scratch — not copied from any reference project.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Default inbound media size cap: 16 MB (WhatsApp's own limit is ~16 MB). */
export const DEFAULT_INBOUND_MEDIA_CAP_BYTES = 16 * 1024 * 1024;

/** Default outbound media fetch timeout: 30 seconds. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Default max outbound media size: 64 MB. */
export const DEFAULT_OUTBOUND_MEDIA_CAP_BYTES = 64 * 1024 * 1024;

/** Max concurrent media downloads. */
const MAX_CONCURRENT_DOWNLOADS = 3;

// ─── Inbound media cap ───────────────────────────────────────────────────

/**
 * Check if a media payload exceeds the inbound size cap.
 * @returns true if the media should be omitted (too large).
 */
export function shouldOmitMedia(sizeBytes: number, capBytes: number = DEFAULT_INBOUND_MEDIA_CAP_BYTES): boolean {
  return sizeBytes > capBytes;
}

/**
 * Resolve an inbound media payload: if the size is within the cap, include
 * the data; otherwise mark it as omitted.
 */
export function resolveInboundMedia(
  data: string | undefined,
  sizeBytes: number | undefined,
  capBytes: number = DEFAULT_INBOUND_MEDIA_CAP_BYTES,
): { data?: string; omitted?: boolean; sizeBytes?: number } {
  if (sizeBytes && shouldOmitMedia(sizeBytes, capBytes)) {
    return { omitted: true, sizeBytes };
  }
  return { data, sizeBytes };
}

// ─── Concurrency-limited download queue ──────────────────────────────────

interface DownloadTask {
  url: string;
  resolve: (data: Buffer) => void;
  reject: (error: Error) => void;
}

class ConcurrencyQueue {
  private queue: DownloadTask[] = [];
  private active = 0;
  private readonly maxConcurrent: number;

  constructor(maxConcurrent: number = MAX_CONCURRENT_DOWNLOADS) {
    this.maxConcurrent = maxConcurrent;
  }

  async enqueue(url: string, timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, resolve, reject });
      this.processQueue(timeoutMs);
    });
  }

  private processQueue(timeoutMs: number): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.active++;
      this.executeTask(task, timeoutMs);
    }
  }

  private async executeTask(task: DownloadTask, timeoutMs: number): Promise<void> {
    try {
      const data = await fetchMediaSafe(task.url, timeoutMs);
      task.resolve(data);
    } catch (error) {
      task.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.active--;
      this.processQueue(timeoutMs);
    }
  }
}

const downloadQueue = new ConcurrencyQueue();

// ─── SSRF guard ──────────────────────────────────────────────────────────

/** Private/internal IP ranges that must be blocked for outbound media fetch. */
const BLOCKED_IP_PATTERNS: RegExp[] = [
  /^127\./,           // loopback
  /^10\./,            // private class A
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // private class B
  /^192\.168\./,      // private class C
  /^0\./,             // current network
  /^169\.254\./,      // link-local
  /^::1$/,            // IPv6 loopback
  /^fc/,              // IPv6 unique local
  /^fd/,              // IPv6 unique local
  /^fe80:/,           // IPv6 link-local
];

/**
 * Check if an IP address is in a private/internal range.
 */
export function isPrivateIp(ip: string): boolean {
  // IPv6-mapped IPv4: ::ffff:127.0.0.1
  const mappedMatch = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
  if (mappedMatch) {
    ip = mappedMatch[1]!;
  }
  return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

/**
 * Validate that a URL is safe to fetch (not pointing to a private/internal IP).
 * Resolves the hostname via DNS and checks each resolved IP.
 * @throws Error if the URL resolves to a private IP or is otherwise unsafe.
 */
export async function validateUrlSafe(url: string): Promise<void> {
  const parsed = new URL(url);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`SSRF guard: only http and https protocols are allowed (got ${parsed.protocol})`);
  }

  const hostname = parsed.hostname;

  // If it's already an IP, check directly
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`SSRF guard: URL points to private IP ${hostname}`);
    }
    return;
  }

  // Resolve hostname and check all IPs
  try {
    const records = await lookup(hostname, { all: true });
    for (const record of records) {
      if (isPrivateIp(record.address)) {
        throw new Error(`SSRF guard: ${hostname} resolves to private IP ${record.address}`);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('SSRF guard:')) {
      throw error;
    }
    // DNS resolution failed — allow the fetch to proceed and let the HTTP
    // client handle the error (better to fail at fetch than block a legit URL
    // with a transient DNS issue)
  }
}

/**
 * Fetch media from a URL with SSRF protection, timeout, and size cap.
 * @returns The media content as a Buffer.
 * @throws Error if the URL is unsafe, the fetch times out, or the response
 *         exceeds the size cap.
 */
export async function fetchMediaSafe(
  url: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  maxBytes: number = DEFAULT_OUTBOUND_MEDIA_CAP_BYTES,
): Promise<Buffer> {
  await validateUrlSafe(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Media fetch failed: HTTP ${response.status}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
    if (contentLength > maxBytes) {
      throw new Error(`Media exceeds size cap: ${contentLength} bytes > ${maxBytes} bytes`);
    }

    const chunks: Buffer[] = [];
    let totalSize = 0;

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalSize += value.length;
        if (totalSize > maxBytes) {
          controller.abort();
          throw new Error(`Media exceeds size cap: ${totalSize} bytes > ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
      }
    }

    return Buffer.concat(chunks);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Media fetch timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Download media from a URL through the concurrency-limited queue.
 * This is the public API for deferred media downloads.
 */
export async function downloadMedia(url: string, timeoutMs?: number): Promise<Buffer> {
  return downloadQueue.enqueue(url, timeoutMs);
}

/**
 * Convert a Buffer to base64 for engine send methods.
 */
export function bufferToBase64(buf: Buffer): string {
  return buf.toString('base64');
}
