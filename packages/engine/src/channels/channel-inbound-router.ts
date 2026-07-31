import type { Agent } from '../agent/Agent.js';

export type ChannelInboundAgentResolver = (channelId: string, senderId?: string) => Agent | null;

let resolver: ChannelInboundAgentResolver | null = null;

export function setChannelInboundAgentResolver(fn: ChannelInboundAgentResolver | null): void {
  resolver = fn;
}

export function resolveChannelInboundAgent(channelId: string, fallback: Agent | null, senderId?: string): Agent | null {
  try {
    return resolver?.(channelId, senderId) ?? fallback;
  } catch {
    return fallback;
  }
}
