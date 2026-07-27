/**
 * Developer Mode endpoints (§9.2, §9.3).
 *
 *   GET  /api/observability/dev/status   — { enabled: boolean } (NOT gated by dev mode)
 *   POST /api/observability/dev/verify   — { password } → verify root password, set dev flag
 *   POST /api/observability/dev/enable   — toggle dev mode on (requires prior verify)
 *   POST /api/observability/dev/disable  — toggle dev mode off, clear the session flag
 *
 * These endpoints are NOT gated by `requireDeveloperMode` — they're needed to
 * unlock dev mode in the first place. They ARE gated by `authMiddleware`
 * (applied globally before the observability router is mounted).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ObservabilityApiContext } from './index.js';
import { authManager } from '@agentx/shared';
import {
  checkVerifyRateLimit,
  isDevMode,
  isDevVerified,
  setDevMode,
  setDevVerified,
  verifyRootPassword,
} from '../../middleware/dev-mode.js';

export function devRouter(_ctx: ObservabilityApiContext): Router {
  const r = Router();

  // GET /dev/status — { enabled, verified }. Does NOT require dev mode.
  r.get('/status', (req: Request, res: Response) => {
    res.json({ enabled: isDevMode(req), verified: isDevVerified(req) });
  });

  // POST /dev/verify — { password } → verify root password, set devVerified flag on success.
  r.post('/verify', async (req: Request, res: Response) => {
    // Rate limit: 5 attempts / 5 min / IP.
    if (!checkVerifyRateLimit(req)) {
      res.status(429).json({ error: 'rate-limited', message: 'Too many verify attempts. Try again in 5 minutes.' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    const password = body?.['password'];
    if (typeof password !== 'string' || !password) {
      res.status(400).json({ error: 'bad-request', message: 'Body must include "password"' });
      return;
    }

    // No root user configured — cannot verify.
    if (!authManager.hasRootUser()) {
      res.status(400).json({ error: 'no-root-user', message: 'No root user has been configured.' });
      return;
    }

    const ok = await verifyRootPassword(password);
    if (!ok) {
      res.status(401).json({ error: 'invalid-credentials', message: 'Incorrect password.' });
      return;
    }

    // Success — set the devVerified flag (NOT devMode yet — enable is a separate step).
    setDevVerified(req, true);
    res.json({ verified: true });
  });

  // POST /dev/enable — toggle dev mode on (requires prior verify in the session).
  r.post('/enable', (req: Request, res: Response) => {
    // Verify must precede enable — check the devVerified flag.
    if (!isDevVerified(req)) {
      res.status(403).json({ error: 'not-verified', message: 'Verify the root password first.' });
      return;
    }
    setDevMode(req, true);
    res.json({ enabled: true });
  });

  // POST /dev/disable — toggle dev mode off, clear both flags.
  r.post('/disable', (req: Request, res: Response) => {
    setDevMode(req, false); // also clears devVerified via setDevMode
    res.json({ enabled: false });
  });

  return r;
}
