#!/usr/bin/env node
/**
 * Send an inter-agent message via the web API.
 * Usage: node scripts/agent-x-send.mjs <fromSessionId> <toSessionId> "message text"
 * Env: AGENTX_PORT (default 3333), AGENTX_API_TOKEN (optional)
 */
const fromSessionId = process.argv[2];
const toSessionId = process.argv[3];
const text = process.argv.slice(4).join(' ').trim();
const port = process.env.AGENTX_PORT ?? '3333';
const base = `http://127.0.0.1:${port}`;

if (!fromSessionId || !toSessionId || !text) {
  console.error('Usage: agent-x-send.mjs <fromSessionId> <toSessionId> "message"');
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json' };
if (process.env.AGENTX_API_TOKEN) {
  headers.Authorization = `Bearer ${process.env.AGENTX_API_TOKEN}`;
}

const res = await fetch(`${base}/api/sessions/${encodeURIComponent(fromSessionId)}/agent-message`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    toSessionId,
    topic: 'cli',
    payload: { text },
    deliveryMode: 'auto',
    receiverRole: 'sibling',
  }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('Send failed:', res.status, body);
  process.exit(1);
}
console.log(JSON.stringify(body, null, 2));
