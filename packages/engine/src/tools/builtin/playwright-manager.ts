import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

interface PendingCall {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
}

let child: ChildProcess | null = null;
let childPromise: Promise<ChildProcess> | null = null;
let childPath: string | null = null;
let callId = 0;
const pending = new Map<string, PendingCall>();

function getChildPath(): string {
  if (childPath) return childPath;
  childPath = fileURLToPath(new URL('./tools/builtin/playwright-manager-child.js', import.meta.url));
  return childPath;
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const childPath = getChildPath();
  const bundledBrowsers = resolve(dirname(childPath), '../../node_modules/playwright-core/.local-browsers');
  if (existsSync(bundledBrowsers)) {
    env.PLAYWRIGHT_BROWSERS_PATH = '0';
  }
  return env;
}

async function ensureChild(): Promise<ChildProcess> {
  if (child && child.connected) return child;
  if (childPromise) return childPromise;
  childPromise = (async () => {
    const path = getChildPath();
    const c = fork(path, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: childEnv() });
    c.on('message', (message: unknown) => {
      const msg = message as { id?: string; output?: string; error?: string; ok?: boolean };
      if (!msg.id) return;
      const call = pending.get(msg.id);
      if (!call) return;
      pending.delete(msg.id);
      if (msg.error) {
        call.reject(new Error(msg.error));
      } else if (typeof msg.output === 'string') {
        call.resolve(msg.output);
      } else if (msg.ok) {
        call.resolve('ok');
      } else {
        call.resolve(JSON.stringify(msg));
      }
    });
    c.on('error', (err) => {
      for (const [, pc] of pending) pc.reject(err);
      pending.clear();
    });
    c.on('exit', () => {
      child = null;
      for (const [, pc] of pending) {
        pc.reject(new Error('Playwright child exited unexpectedly'));
      }
      pending.clear();
    });
    return c;
  })();
  try {
    const c = await childPromise;
    child = c;
    return c;
  } finally {
    childPromise = null;
  }
}

async function sendAndWait(message: Record<string, unknown>): Promise<string> {
  const id = `pw-${++callId}`;
  const c = await ensureChild();
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      const ok = c.send({ ...message, id });
      if (!ok) {
        pending.delete(id);
        reject(new Error('Playwright child send buffer full'));
      }
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function defaultUserDataDir(scopePath: string): string {
  return resolve(scopePath, '.agentx', 'browser-profiles', 'default');
}

export async function runInPlaywright(
  task: string,
  options: { userDataDir: string; headless: boolean; shield?: boolean },
): Promise<string> {
  return sendAndWait({
    type: 'run',
    task,
    userDataDir: options.userDataDir,
    headless: options.headless,
    shield: options.shield ?? false,
  });
}
