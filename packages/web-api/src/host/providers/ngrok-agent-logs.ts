/**
 * Shared ngrok agent log / CLI helpers used by credential probes and tunnel spawn.
 */
import { spawn, type ChildProcess } from 'node:child_process';

const AUTH_FAIL_RE =
  /authentication failed|ERR_NGROK_105|ERR_NGROK_108|ERR_NGROK_4018|does not look like a proper ngrok authtoken|invalid authtoken/i;
const SESSION_OK_RE =
  /started tunnel|client session established|tunnel session started|msg":"started tunnel"/i;

/** Reject obvious non-authtoken pastes before spawning the agent (ERR_NGROK_105). */
export function validateNgrokAuthtokenShape(raw: string): { ok: true; token: string } | { ok: false; message: string } {
  const token = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!token) {
    return { ok: false, message: 'ngrok authtoken is required' };
  }
  if (/^cr_/i.test(token)) {
    return {
      ok: false,
      message:
        'That looks like an ngrok credential id (cr_…), not an Authtoken. Open https://dashboard.ngrok.com/get-started/your-authtoken and copy the Authtoken.',
    };
  }
  if (/^(api[_-]?key|sk_|nk_)/i.test(token) || token.includes('api.ngrok.com')) {
    return {
      ok: false,
      message:
        'That looks like an API key, not an agent Authtoken. Use Your Authtoken from the ngrok dashboard (not API Keys).',
    };
  }
  // Agent authtokens are long and typically look like: 2xxxxxxxx_yyyyyyyy…
  if (token.length < 30) {
    return {
      ok: false,
      message:
        'Authtoken looks too short. Copy the full Authtoken from https://dashboard.ngrok.com/get-started/your-authtoken (not a truncated or credential id).',
    };
  }
  if (!/^[A-Za-z0-9:_-]{30,}$/.test(token)) {
    return {
      ok: false,
      message:
        'Authtoken has unexpected characters. Paste only the Authtoken string from the ngrok dashboard (no spaces or quotes).',
    };
  }
  return { ok: true, token };
}

export function resolveNgrokAuthtokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const candidates = [env['NGROK_AUTHTOKEN'], env['NGROK_AUTH_TOKEN'], env['AGENTX_NGROK_AUTHTOKEN']];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return undefined;
}

export function extractNgrokPublicUrl(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as { url?: unknown; addr?: unknown };
    if (typeof parsed.url === 'string' && /^https?:\/\//.test(parsed.url)) return parsed.url;
  } catch {
    /* plain text below */
  }
  const match =
    trimmed.match(/url=(https?:\/\/\S+)/) ??
    trimmed.match(/"(https:\/\/[a-z0-9-]+\.ngrok(?:-free)?\.(?:app|dev|io)[^"]*)"/i);
  return match?.[1]?.replace(/[,\s]+$/, '');
}

/** Pull the most useful human error from ngrok agent output (never include full token). */
export function extractNgrokFailureMessage(output: string): string | null {
  const errCode = output.match(/ERR_NGROK_\d+/);
  const authLine = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => AUTH_FAIL_RE.test(l) || /^ERROR:\s+/i.test(l));

  if (authLine) {
    let cleaned = authLine
      .replace(/^ERROR:\s*/i, '')
      .replace(/Your authtoken:\s*\S+/gi, 'Your authtoken: [redacted]')
      .replace(/\\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Prefer JSON err field when present
    try {
      const parsed = JSON.parse(authLine) as { err?: unknown; msg?: unknown };
      if (typeof parsed.err === 'string' && parsed.err.trim()) {
        cleaned = parsed.err
          .replace(/Your authtoken:\s*\S+/gi, 'Your authtoken: [redacted]')
          .replace(/\r?\n/g, ' ')
          .trim();
      }
    } catch {
      /* not JSON */
    }
    if (errCode && !cleaned.includes(errCode[0]!)) {
      return `${cleaned} (${errCode[0]})`;
    }
    return cleaned.slice(0, 400);
  }

  // JSON log lines with err=
  for (const line of output.split(/\r?\n/)) {
    try {
      const parsed = JSON.parse(line) as { err?: unknown; msg?: unknown; lvl?: unknown };
      if (typeof parsed.err === 'string' && /fail|error|auth/i.test(parsed.err)) {
        return parsed.err
          .replace(/Your authtoken:\s*\S+/gi, 'Your authtoken: [redacted]')
          .replace(/\r?\n/g, ' ')
          .trim()
          .slice(0, 400);
      }
    } catch {
      /* continue */
    }
  }

  if (errCode) return `ngrok agent failed (${errCode[0]})`;
  return null;
}

export function ngrokOutputIndicatesAuthFailure(output: string): boolean {
  return AUTH_FAIL_RE.test(output);
}

export function ngrokOutputIndicatesSessionOk(output: string): boolean {
  return SESSION_OK_RE.test(output) || Boolean(extractNgrokPublicUrl(output));
}

/**
 * Probe an authtoken by briefly starting the official agent.
 * Authtokens are agent credentials — api.ngrok.com API-key checks are the wrong validator.
 */
export function probeNgrokAuthtoken(input: {
  binPath: string;
  token: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; message: string }> {
  const timeoutMs = input.timeoutMs ?? 8_000;
  const addr = '127.0.0.1:9'; // discard port — we only care about session auth
  const args = [
    'http',
    addr,
    `--authtoken=${input.token}`,
    '--log=stdout',
    '--log-format=json',
  ];

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(input.binPath, args, {
        env: { ...process.env, NGROK_AUTHTOKEN: input.token },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        ok: false,
        message: err instanceof Error ? err.message : 'Failed to spawn ngrok for credential test',
      });
      return;
    }

    let output = '';
    let settled = false;

    const finish = (result: { ok: boolean; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const onChunk = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (ngrokOutputIndicatesAuthFailure(output)) {
        finish({
          ok: false,
          message: extractNgrokFailureMessage(output) ?? 'ngrok rejected this authtoken',
        });
        return;
      }
      if (ngrokOutputIndicatesSessionOk(output) || extractNgrokPublicUrl(output)) {
        finish({ ok: true, message: 'ngrok authtoken accepted by agent' });
      }
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);
    child.on('error', (err) => {
      finish({ ok: false, message: err.message });
    });
    child.on('exit', () => {
      if (settled) return;
      if (ngrokOutputIndicatesAuthFailure(output)) {
        finish({
          ok: false,
          message: extractNgrokFailureMessage(output) ?? 'ngrok rejected this authtoken',
        });
        return;
      }
      if (ngrokOutputIndicatesSessionOk(output)) {
        finish({ ok: true, message: 'ngrok authtoken accepted by agent' });
        return;
      }
      finish({
        ok: false,
        message:
          extractNgrokFailureMessage(output) ??
          'ngrok agent exited before confirming the authtoken — paste a fresh token from the ngrok dashboard',
      });
    });

    const timer = setTimeout(() => {
      // Still running without auth failure usually means the session is alive.
      if (ngrokOutputIndicatesAuthFailure(output)) {
        finish({
          ok: false,
          message: extractNgrokFailureMessage(output) ?? 'ngrok rejected this authtoken',
        });
        return;
      }
      if (output.includes('starting web service') || ngrokOutputIndicatesSessionOk(output)) {
        finish({ ok: true, message: 'ngrok authtoken accepted by agent' });
        return;
      }
      finish({
        ok: false,
        message:
          extractNgrokFailureMessage(output) ??
          'Timed out waiting for ngrok to accept the authtoken',
      });
    }, timeoutMs);
  });
}
