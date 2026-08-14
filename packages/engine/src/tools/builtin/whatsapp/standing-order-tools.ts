import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import { getContactDirectoryStoreInstance, getStandingOrderStoreInstance } from '../../../services/ServiceContext.js';
import type { StandingOrderStore } from '../../../whatsapp/jarvis/StandingOrderStore.js';
import { toNeutralJid } from '../../../whatsapp/identity/wa-id.js';
import { formatResolveForTool } from '../../../whatsapp/contacts/formatContact.js';
import { resolveContact } from '../../../whatsapp/contacts/resolveContact.js';
import type {
  StandingOrderAction,
  StandingOrderChatKind,
  StandingOrderMatch,
  StandingOrderSource,
} from '../../../whatsapp/jarvis/standing-order-types.js';
import { optionalBoolean, optionalNumber, optionalString, requireString, runTool } from './helpers.js';

function requireStore(): StandingOrderStore | { error: ToolResult } {
  const store = getStandingOrderStoreInstance();
  if (!store) {
    return {
      error: {
        success: false,
        output: 'WhatsApp standing orders are not available. Enable and link WhatsApp first.',
        error: 'WHATSAPP_NOT_CONFIGURED',
      },
    };
  }
  return store;
}

function sourceFromContext(context: ToolExecutionContext): StandingOrderSource {
  if (context.sourceChannel === 'whatsapp') return 'self_chat';
  if (context.sourceChannel === 'voice' || context.voiceTurn) return 'voice';
  return 'desktop';
}

function parseChatKind(value: string | undefined): StandingOrderChatKind {
  if (value === 'dm' || value === 'group' || value === 'any') return value;
  return 'any';
}

function parseActionType(value: string | undefined): StandingOrderAction['type'] {
  if (value === 'auto_reply' || value === 'ignore' || value === 'brief') return value;
  return 'brief';
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return items.length > 0 ? items : undefined;
}

export async function whatsappStandingOrderList(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('list standing orders', async () => {
    const resolved = requireStore();
    if ('error' in resolved) return resolved.error;
    const enabledOnly = optionalBoolean(args, 'enabledOnly') ?? false;
    const orders = await resolved.list(enabledOnly);
    if (orders.length === 0) {
      return {
        success: true,
        output: enabledOnly
          ? 'No active WhatsApp standing orders.'
          : 'No WhatsApp standing orders. Create one with whatsapp_standing_order_upsert.',
        metadata: { orders: [] },
      };
    }
    const lines = orders.map((o) => {
      const matchBits = [
        o.match.senders?.length ? `senders=${o.match.senders.join(',')}` : '',
        o.match.groups?.length ? `groups=${o.match.groups.join(',')}` : '',
        o.match.keywords?.length ? `keywords=${o.match.keywords.join(',')}` : '',
        `chat=${o.match.chatKind ?? 'any'}`,
      ].filter(Boolean);
      const action = o.action.type === 'auto_reply'
        ? `auto_reply "${o.action.replyTemplate ?? ''}"`
        : o.action.type;
      return `- ${o.enabled ? 'ON' : 'OFF'} ${o.title} (${o.id}): ${action} · ${matchBits.join(' ')}`;
    });
    return {
      success: true,
      output: `WhatsApp standing orders:\n${lines.join('\n')}`,
      metadata: { orders },
    };
  });
}

export async function whatsappStandingOrderUpsert(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('upsert standing order', async () => {
    const resolved = requireStore();
    if ('error' in resolved) return resolved.error;

    const title = requireString(args, 'title');
    if (typeof title !== 'string') return title;

    const actionType = parseActionType(optionalString(args, 'action'));
    const replyTemplate = optionalString(args, 'replyTemplate');
    if (actionType === 'auto_reply' && !replyTemplate) {
      return {
        success: false,
        output: 'auto_reply standing orders require replyTemplate — the exact text to send as the owner.',
        error: 'MISSING_INPUT',
      };
    }

    const senderTokens = asStringArray(args['senders']) ?? [];
    const senders: string[] = [];
    for (const token of senderTokens) {
      const directory = getContactDirectoryStoreInstance();
      const resolvedSender = directory ? directory.resolve(token) : resolveContact(token, []);
      if (resolvedSender.status === 'unique') {
        if (!resolvedSender.contact.sendable) {
          return formatResolveForTool(resolvedSender);
        }
        senders.push(resolvedSender.contact.jid);
        continue;
      }
      return formatResolveForTool(resolvedSender);
    }
    const groups = (asStringArray(args['groups']) ?? []).map((j) => toNeutralJid(j));
    const keywords = asStringArray(args['keywords']);
    const match: StandingOrderMatch = {
      senders: senders.length ? senders : undefined,
      groups: groups.length ? groups : undefined,
      keywords,
      chatKind: parseChatKind(optionalString(args, 'chatKind')),
    };

    const action: StandingOrderAction = {
      type: actionType,
      replyTemplate,
      announceVoice: optionalBoolean(args, 'announceVoice'),
    };

    const order = await resolved.upsert({
      id: optionalString(args, 'id'),
      title,
      enabled: optionalBoolean(args, 'enabled'),
      priority: optionalNumber(args, 'priority'),
      match,
      action,
      createdFrom: sourceFromContext(context),
    });

    return {
      success: true,
      output: `Standing order "${order.title}" saved (${order.id}). Action: ${order.action.type}.`,
      metadata: { order },
    };
  });
}

export async function whatsappStandingOrderRevoke(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('revoke standing order', async () => {
    const resolved = requireStore();
    if ('error' in resolved) return resolved.error;

    if (optionalBoolean(args, 'revokeAll')) {
      const count = await resolved.revokeAll();
      return {
        success: true,
        output: count === 0 ? 'No standing orders to revoke.' : `Revoked ${count} standing order(s).`,
        metadata: { count },
      };
    }

    const id = optionalString(args, 'id');
    const title = optionalString(args, 'title');
    if (!id && !title) {
      return {
        success: false,
        output: 'Provide id, title, or revokeAll:true.',
        error: 'MISSING_INPUT',
      };
    }

    const ok = id
      ? await resolved.revoke(id)
      : await resolved.revokeByTitle(title!);
    return {
      success: ok,
      output: ok
        ? `Revoked standing order ${id ?? title}.`
        : `No standing order matched ${id ?? title}.`,
    };
  });
}
