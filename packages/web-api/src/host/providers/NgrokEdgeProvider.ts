import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import type { TunnelProviderCatalogEntry, TunnelProviderCredentials, TunnelStatus } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { recordHostEvent } from '../audit.js';
import type {
  EdgeCredentialTestResult,
  EdgeStartRequest,
  PublicEdgeProvider,
} from '../PublicEdgeGateway.js';
import { idleTunnelStatus, withState } from '../PublicEdgeGateway.js';
import {
  ensureNgrokBinary,
  getManagedNgrokBinaryPath,
} from './ngrok-binary.js';
import {
  extractNgrokFailureMessage,
  extractNgrokPublicUrl,
  probeNgrokAuthtoken,
  resolveNgrokAuthtokenFromEnv,
  validateNgrokAuthtokenShape,
} from './ngrok-agent-logs.js';

const LOCAL_AGENT_API = 'http://127.0.0.1:4040/api/tunnels';
const START_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 500;

interface LocalAgentTunnel {
  public_url?: string;
  proto?: string;
  config?: { addr?: string };
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Search PATH for an executable named `bin` (which(1)-style, no shell involved). */
function resolveFromPath(bin: string): string | null {
  const pathEnv = process.env['PATH'] ?? '';
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${bin}.exe`, `${bin}.cmd`, bin] : [bin];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate) && isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Well-known install locations (GUI/desktop apps often have a minimal PATH that
 * omits Homebrew). Still an allowlist — never accept paths from request bodies.
 */
const NGROK_WELL_KNOWN_PATHS: readonly string[] = [
  '/opt/homebrew/bin/ngrok', // Apple Silicon Homebrew
  '/usr/local/bin/ngrok', // Intel Homebrew / Linux packages
  '/usr/bin/ngrok',
];

/**
 * Resolve the ngrok binary from an explicit allowlist of locations only:
 * `AGENTX_NGROK_BIN`, Agent-X managed data-dir install, well-known paths, or PATH.
 * Never accept an arbitrary path from request bodies or persisted config.
 */
export function resolveNgrokBinary(): string | null {
  const fromEnv = process.env['AGENTX_NGROK_BIN'];
  if (fromEnv && isAbsolute(fromEnv) && existsSync(fromEnv) && isExecutableFile(fromEnv)) {
    return fromEnv;
  }
  const managed = getManagedNgrokBinaryPath();
  if (existsSync(managed) && isExecutableFile(managed)) return managed;
  for (const candidate of NGROK_WELL_KNOWN_PATHS) {
    if (existsSync(candidate) && isExecutableFile(candidate)) return candidate;
  }
  return resolveFromPath('ngrok');
}

/**
 * Ngrok edge provider.
 *
 * Start order of preference:
 * 1. An ngrok agent already running locally (local agent API on :4040) with a
 *    tunnel pointed at our upstream port — adopt it, we don't own the process.
 * 2. Resolve or auto-download the official `ngrok` binary into Agent-X data dir,
 *    then spawn and supervise it.
 * 3. If auto-install is disabled / fails — fail closed with an actionable message.
 */
export class NgrokEdgeProvider implements PublicEdgeProvider {
  readonly id = 'ngrok' as const;
  readonly catalog: TunnelProviderCatalogEntry = {
    id: 'ngrok',
    name: 'ngrok',
    tagline: 'Free-tier HTTPS tunnel — agent auto-installed by Agent-X',
    accent: '#1F1E37',
    setupSteps: [
      'Dashboard → Getting Started → Your Authtoken (not API Keys, not credential ids).',
      'Paste the full Authtoken below, then Enable secure tunnel.',
      'After the tunnel is active, use Test connection to verify.',
    ],
    credentialFields: [
      {
        key: 'authToken',
        label: 'Authtoken',
        secret: true,
        required: true,
        placeholder: '2…_… (from Your Authtoken)',
        helperText: 'Must be Your Authtoken — not an API key and not a cr_… credential id.',
      },
    ],
    supportsRegion: true,
  };

  private status: TunnelStatus = idleTunnelStatus('ngrok');
  private readonly fetchImpl: typeof fetch;
  private childProcess: ChildProcess | null = null;
  /** True when `childProcess` is a process we spawned (and must supervise/kill). */
  private ownsProcess = false;

  constructor(options?: { fetchImpl?: typeof fetch }) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  async testCredentials(credentials: TunnelProviderCredentials): Promise<EdgeCredentialTestResult> {
    const shaped = validateNgrokAuthtokenShape(credentials.authToken ?? '');
    if (!shaped.ok) return { ok: false, message: shaped.message };
    const token = shaped.token;

    let binPath = resolveNgrokBinary();
    if (!binPath) {
      try {
        binPath = await ensureNgrokBinary({ preferExisting: null });
      } catch (err) {
        return {
          ok: false,
          message:
            err instanceof Error
              ? `Cannot test authtoken — ngrok agent unavailable (${err.message})`
              : 'Cannot test authtoken — ngrok agent unavailable',
        };
      }
    }

    // Authtokens are agent credentials. The REST API uses API keys and must not
    // be used as a validator (404-as-success previously accepted any garbage).
    return probeNgrokAuthtoken({ binPath, token });
  }

  /** Query the local ngrok agent API (127.0.0.1:4040) for a tunnel matching `upstreamPort`. */
  private async findLocalAgentTunnel(upstreamPort: number): Promise<LocalAgentTunnel | undefined> {
    try {
      const res = await this.fetchImpl(LOCAL_AGENT_API, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return undefined;
      const data = (await res.json()) as { tunnels?: LocalAgentTunnel[] };
      const tunnels = data.tunnels ?? [];
      const matching = tunnels.filter((t) => t.config?.addr?.includes(String(upstreamPort)));
      return matching.find((t) => t.proto === 'https') ?? matching[0];
    } catch {
      return undefined;
    }
  }

  private static extractUrlFromLogLine(line: string): string | undefined {
    return extractNgrokPublicUrl(line);
  }

  private async spawnAndSupervise(input: EdgeStartRequest, binPath: string, token: string): Promise<TunnelStatus> {
    return new Promise((resolvePromise) => {
      const upstream = `${input.upstreamHost}:${input.upstreamPort}`;
      const args = [
        'http',
        upstream,
        `--authtoken=${token}`,
        '--log=stdout',
        '--log-format=json',
      ];
      let child: ChildProcess;
      try {
        child = spawn(binPath, args, {
          env: { ...process.env, NGROK_AUTHTOKEN: token },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        this.status = withState(this.status, 'error', {
          lastError: `Failed to spawn ngrok: ${err instanceof Error ? err.message : String(err)}`,
        });
        resolvePromise(this.status);
        return;
      }

      this.childProcess = child;
      this.ownsProcess = true;
      let settled = false;
      let output = '';

      const finish = (next: TunnelStatus) => {
        if (settled) return;
        settled = true;
        clearInterval(pollHandle);
        clearTimeout(timeoutHandle);
        this.status = next;
        resolvePromise(next);
      };

      const finalizeActive = (publicUrl: string) => {
        const active = withState(this.status, 'active', {
          publicUrl,
          tunnelId: `ngrok-pid-${child.pid ?? 'unknown'}`,
          region: input.region ?? 'auto',
          protocol: publicUrl.startsWith('https') ? 'https' : 'http',
          pid: child.pid ?? null,
          startedAt: new Date().toISOString(),
          verifiedUpstream: true,
          lastError: null,
        });
        recordHostEvent({
          category: 'tunnel',
          code: 'ngrok_process_started',
          message: 'ngrok agent process reported an active tunnel',
          metadata: { pid: child.pid ?? undefined, publicUrl },
        });
        finish(active);
      };

      const finalizeError = (message: string) => {
        recordHostEvent({ category: 'tunnel', code: 'ngrok_process_error', message });
        finish(withState(this.status, 'error', { lastError: message, pid: null }));
      };

      const onOutput = (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        output += text;
        // Cap retained log buffer used for error extraction
        if (output.length > 32_000) output = output.slice(-24_000);
        for (const line of text.split('\n')) {
          const url = NgrokEdgeProvider.extractUrlFromLogLine(line);
          if (url) {
            finalizeActive(url);
            return;
          }
        }
      };

      child.stdout?.on('data', onOutput);
      child.stderr?.on('data', onOutput);

      child.on('error', (err) => {
        finalizeError(err instanceof Error ? err.message : String(err));
      });

      child.on('exit', (code, signal) => {
        this.childProcess = null;
        this.ownsProcess = false;
        if (!settled) {
          const detail =
            extractNgrokFailureMessage(output) ??
            `ngrok exited before reporting a tunnel URL (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
          finalizeError(detail);
          return;
        }
        if (this.status.state === 'active') {
          this.status = withState(this.status, 'error', {
            lastError: `ngrok process exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
            pid: null,
          });
          recordHostEvent({
            category: 'tunnel',
            code: 'ngrok_process_exited',
            message: `ngrok process exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
          });
        }
      });

      const pollHandle = setInterval(() => {
        void this.findLocalAgentTunnel(input.upstreamPort).then((tunnel) => {
          if (tunnel?.public_url) finalizeActive(tunnel.public_url);
        });
      }, POLL_INTERVAL_MS);
      const timeoutHandle = setTimeout(() => {
        finalizeError(
          extractNgrokFailureMessage(output) ??
            `Timed out waiting for ngrok to report a public URL (${START_TIMEOUT_MS}ms)`,
        );
        child.kill('SIGTERM');
      }, START_TIMEOUT_MS);
    });
  }

  async start(input: EdgeStartRequest): Promise<TunnelStatus> {
    this.status = withState(this.status, 'authenticating');
    const rawToken = input.credentials.authToken?.trim() || resolveNgrokAuthtokenFromEnv();
    const shaped = validateNgrokAuthtokenShape(rawToken ?? '');
    if (!shaped.ok) {
      this.status = withState(this.status, 'error', { lastError: shaped.message });
      return this.status;
    }
    const token = shaped.token;

    this.status = withState(this.status, 'starting', { lastError: null });
    const existing = await this.findLocalAgentTunnel(input.upstreamPort);
    if (existing?.public_url) {
      this.ownsProcess = false;
      this.status = withState(this.status, 'active', {
        publicUrl: existing.public_url,
        tunnelId: 'ngrok-local-agent',
        region: input.region ?? 'auto',
        protocol: existing.public_url.startsWith('https') ? 'https' : 'http',
        pid: null,
        startedAt: new Date().toISOString(),
        verifiedUpstream: true,
        lastError: null,
      });
      recordHostEvent({
        category: 'tunnel',
        code: 'ngrok_local_agent_adopted',
        message: 'Adopted an already-running local ngrok agent tunnel',
        metadata: { publicUrl: existing.public_url },
      });
      return this.status;
    }

    // Resolve system/managed binary, or auto-download official agent into data dir.
    let binPath = resolveNgrokBinary();
    if (!binPath) {
      try {
        recordHostEvent({
          category: 'tunnel',
          code: 'ngrok_auto_install_begin',
          message: 'Downloading official ngrok agent into Agent-X data directory',
        });
        binPath = await ensureNgrokBinary({ preferExisting: null });
        recordHostEvent({
          category: 'tunnel',
          code: 'ngrok_auto_install_ok',
          message: 'ngrok agent ready',
          metadata: { binPath },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        getLogger().warn('NGROK_TUNNEL_START_NO_AGENT', 'ngrok auto-install failed', {
          error: message,
          upstream: `${input.upstreamHost}:${input.upstreamPort}`,
        });
        this.status = withState(this.status, 'error', {
          lastError:
            `Could not prepare the ngrok agent automatically: ${message}. ` +
            'Set AGENTX_NGROK_BIN to an absolute path, or install ngrok manually, then Enable again.',
        });
        return this.status;
      }
    }

    getLogger().info('NGROK_TUNNEL_SPAWN', 'Spawning allowlisted ngrok binary', {
      binPath,
      upstream: `${input.upstreamHost}:${input.upstreamPort}`,
    });
    return this.spawnAndSupervise(input, binPath, token);
  }

  async stop(): Promise<TunnelStatus> {
    this.status = withState(this.status, 'stopping');
    if (this.childProcess && this.ownsProcess) {
      const child = this.childProcess;
      await new Promise<void>((resolveStop) => {
        const forceKill = setTimeout(() => {
          child.kill('SIGKILL');
        }, 5000);
        child.once('exit', () => {
          clearTimeout(forceKill);
          resolveStop();
        });
        child.kill('SIGTERM');
      });
    }
    this.childProcess = null;
    this.ownsProcess = false;
    this.status = withState(idleTunnelStatus('ngrok'), 'stopped');
    return this.status;
  }

  async restart(input: EdgeStartRequest): Promise<TunnelStatus> {
    await this.stop();
    return this.start(input);
  }

  getStatus(): TunnelStatus {
    return this.status;
  }
}
