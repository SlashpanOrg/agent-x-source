import type { AdoptionAgentMessage } from '@agentx/shared';
import { getInterAgentMessageService } from './InterAgentMessageService.js';

export function formatInterAgentMessage(msg: AdoptionAgentMessage): string {
  const payload = msg.payload;
  const body =
    typeof payload.text === 'string'
      ? payload.text
      : typeof payload.summary === 'string'
        ? payload.summary
        : JSON.stringify(payload);
  return `[From ${msg.fromSessionId} topic=${msg.topic}]\n${body}`;
}

export interface InterAgentDeliveryContext {
  sessionId: string;
  isProcessing: () => boolean;
  appendAutoBlock: (text: string) => void;
  queueFollowUp: (text: string) => void;
  steer: (instruction: string) => boolean;
  emitAgentMessage: (msg: AdoptionAgentMessage) => void;
}

export async function deliverInterAgentMessage(
  ctx: InterAgentDeliveryContext,
  msg: AdoptionAgentMessage,
): Promise<void> {
  const text = formatInterAgentMessage(msg);
  ctx.emitAgentMessage(msg);
  switch (msg.deliveryMode) {
    case 'steer':
      if (ctx.isProcessing()) {
        ctx.steer(text);
      } else {
        ctx.appendAutoBlock(text);
      }
      break;
    case 'follow_up':
      ctx.queueFollowUp(text);
      break;
    default:
      ctx.appendAutoBlock(text);
      break;
  }
  await getInterAgentMessageService().markDelivered(msg.id);
}

export async function processPendingInterAgentMessages(ctx: InterAgentDeliveryContext): Promise<void> {
  const svc = getInterAgentMessageService();
  if (!svc.isEnabled()) return;
  const pending = await svc.listPending(ctx.sessionId);
  for (const msg of pending) {
    await deliverInterAgentMessage(ctx, msg);
  }
}
