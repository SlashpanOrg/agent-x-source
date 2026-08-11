/** Inter-agent message delivery modes (Prime Agent adoption). */

export type AgentMessageDeliveryMode = 'auto' | 'steer' | 'follow_up';
export type AgentMessageReceiverRole = 'parent' | 'sibling' | 'self';

export interface AdoptionAgentMessage {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  topic: string;
  payload: Record<string, unknown>;
  deliveryMode: AgentMessageDeliveryMode;
  receiverRole: AgentMessageReceiverRole;
  timestamp: number;
  deliveredAt?: string;
}
