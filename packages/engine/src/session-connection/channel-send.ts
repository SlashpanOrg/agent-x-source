import type { Message } from '@agentx/shared';
import type { Agent } from '../agent/Agent.js';
import { createInProcessSessionConnection } from './InProcessSessionConnection.js';

/** Channel/gateway inbound path — routes sends through SessionConnection. */
export async function sendViaSessionConnection(
  agent: Agent,
  content: string,
  options?: Record<string, unknown>,
): Promise<Message> {
  return createInProcessSessionConnection(agent).sendMessage(content, options as never) as Promise<Message>;
}

export function cancelViaSessionConnection(agent: Agent): void {
  createInProcessSessionConnection(agent).cancel();
}
