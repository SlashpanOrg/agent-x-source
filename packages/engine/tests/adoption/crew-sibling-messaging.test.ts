import { describe, it, expect } from 'vitest';
import { getInterAgentMessageService } from '../../src/inter-agent-messaging/InterAgentMessageService.js';

describe('crew sibling session ids (X-INT-21)', () => {
  it('allows messaging between crew siblings under same host session', async () => {
    const svc = getInterAgentMessageService();
    const ok = await svc.canMessageSibling('sess-a::crew:c1', 'sess-a::crew:c2');
    expect(ok).toBe(true);
  });

  it('blocks crew siblings on different host sessions', async () => {
    const svc = getInterAgentMessageService();
    const ok = await svc.canMessageSibling('sess-a::crew:c1', 'sess-b::crew:c2');
    expect(ok).toBe(false);
  });
});
