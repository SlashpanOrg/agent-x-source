import { getLogger } from '@agentx/shared';
import { getAutomationService } from './automation/index.js';
import { resolveInboundAgentForChannel } from './channel-session-bridge.js';
import { getEngine } from './engine.js';
import type { JarvisNotificationInput } from '@agentx/engine';
import { parseWhatsAppVoiceBriefFromContext, setWhatsAppVoiceBrief } from './whatsapp-voice-brief.js';

function injectPendingBrief(context: string): void {
  try {
    const eng = getEngine();
    const seen = new Set<object>();
    const agents = [eng.agent, eng.channelAgent, ...(eng.channelAgents ? [...eng.channelAgents.values()] : [])];
    for (const agent of agents) {
      if (!agent || seen.has(agent)) continue;
      seen.add(agent);
      try {
        agent.addToHistory({ role: 'system', content: context });
      } catch { /* best-effort */ }
    }
    const store = eng.sessionManager?.getStorageAdapter?.();
    store?.insertMessage?.({
      sessionId: '__channel__:voice',
      role: 'system',
      content: context,
    });
  } catch { /* engine warming */ }
}

function rememberVoiceBrief(context: string): void {
  const brief = parseWhatsAppVoiceBriefFromContext(context);
  if (brief) setWhatsAppVoiceBrief(brief);
}

export function createWhatsAppJarvisHooks() {
  return {
    ensureOwnerAgent: () => {
      try {
        return resolveInboundAgentForChannel('whatsapp');
      } catch (err) {
        getLogger().warn(
          'WHATSAPP_JARVIS',
          `ensureOwnerAgent failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    },
    publishNotification: async (input: JarvisNotificationInput) => {
      const svc = getAutomationService();
      if (!svc) return;
      await svc.publishNotification({
        kind: 'whatsapp_inbound',
        title: input.title,
        body: input.body,
        channels: ['in_app', 'desktop'],
        payload: input.payload,
      });
    },
    announceVoice: async (line: string, context?: string) => {
      if (context) {
        rememberVoiceBrief(context);
        injectPendingBrief(context);
      }
      const { announceToActiveVoiceSessions } = await import('./voice-ws.js');
      await announceToActiveVoiceSessions(line, context);
    },
  };
}
