import {
  isChannelSessionId,
  normalizePermissionHandlerResult,
  isAgentInternalPath,
  type PermissionDecision,
  type PermissionRule,
  type ToolDefinition,
} from '@agentx/shared';
import type { PermissionManager } from '../../tools/permissions/PermissionManager.js';
import { evaluateRules } from '../../tools/permissions/RuleEngine.js';
import { isPermissionExemptTool } from '../../tools/permissions/exempt-tools.js';
import { isIntegrationToolId } from '../../integrations/action-classifier.js';
import { buildIntegrationActionPreview } from '../../integrations/action-preview.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { PermissionPromptHook, PermissionRequestHandler } from '../../tools/ToolExecutor.js';

const PATH_KEYS = ['path', 'filePath', 'file', 'target', 'from', 'to', 'cwd', 'output', 'source', 'archive', 'file1', 'file2', 'database'];

function allPathsAreAgentInternal(args: Record<string, unknown>): boolean {
  let hasPath = false;
  for (const key of PATH_KEYS) {
    const val = args[key];
    if (typeof val === 'string' && val.trim()) {
      hasPath = true;
      if (!isAgentInternalPath(val)) return false;
    }
  }
  return hasPath;
}

export interface PermissionResult {
  decision: 'allow' | 'allow_once' | 'allow_always' | 'deny' | 'ask';
  error?: 'MODE_RESTRICTED' | 'PERMISSION_DENIED' | 'PERMISSION_INSTRUCTED' | 'SCOPE_VIOLATION';
  instruction?: string;
}

/**
 * Minimal host abstraction so the permission service can be used by ToolExecutor
 * or any other wrapper without coupling to the full ToolExecutor class.
 */
export interface ToolPermissionHost {
  getPermissionManager(): PermissionManager;
  getRegistry(): ToolRegistry;
  getPermissionRequestHandler(): PermissionRequestHandler | undefined;
  getChannelPermissionRequestHandler(): PermissionRequestHandler | undefined;
  getPermissionPromptHook(): PermissionPromptHook | undefined;
  getAlwaysPromptPermissions(): boolean;
  getMessagingPermissionMode(): boolean;
  getInboundSourceChannel(): string | null;
  getSessionRules(): PermissionRule[];
  getAgentPermissions(): PermissionRule[];
  getUserConfigRules(): PermissionRule[];
  /** When bypass is OFF, the agent must ask the user before permission-requiring tools. Returns the set of tool IDs the user has already consented to this turn. */
  getPendingToolConsent?(): Set<string> | null;
}

/**
 * Encapsulates tool permission rule evaluation and interactive prompting.
 *
 * This keeps ToolExecutor focused on execution while centralizing the
 * permission policy logic in one testable unit.
 */
export class ToolPermissionService {
  async requestPermission(
    host: ToolPermissionHost,
    toolId: string,
    args: Record<string, unknown>,
    sessionId: string,
    scopePath?: string,
    tool?: ToolDefinition,
  ): Promise<PermissionResult> {
    const definition = tool ?? host.getRegistry().get(toolId);
    if (!definition) {
      return { decision: 'deny', error: 'MODE_RESTRICTED' };
    }

    const permissionManager = host.getPermissionManager();
    const existingGrant = permissionManager.check(toolId, scopePath ?? undefined);
    if (existingGrant === 'allow_always') {
      return { decision: 'allow' };
    }
    if (existingGrant === 'allow_once') {
      // One-time grants are honored for the remainder of the turn/session so the
      // user is not re-prompted for the same tool repeatedly.
      return { decision: 'allow' };
    }
    if (existingGrant === 'deny') {
      return { decision: 'deny', error: 'PERMISSION_DENIED' };
    }

    const path = scopePath ?? '*';
    const ruleResult = evaluateRules(
      `tool:${toolId}`,
      path,
      host.getAgentPermissions(),
      host.getSessionRules(),
      host.getUserConfigRules(),
    );

    if (ruleResult === 'deny') {
      return { decision: 'deny', error: 'MODE_RESTRICTED' };
    }

    const permissionExempt = isPermissionExemptTool(toolId);
    if (permissionExempt || ruleResult === 'allow') {
      return { decision: 'allow' };
    }

    // Internal app files/tmp are app-owned scratch/deliverable directories — never prompt.
    if (allPathsAreAgentInternal(args)) {
      return { decision: 'allow' };
    }

    const shouldPrompt = host.getAlwaysPromptPermissions() || definition.riskLevel !== 'low';
    if (!shouldPrompt) {
      return { decision: 'allow' };
    }

    // ─── Bypass-mode consent enforcement (STRICT) ───
    // When bypass is OFF, the agent must ask the user via a normal inline question
    // BEFORE calling any tool that would trigger a permission prompt. If no prior
    // consent was recorded for this tool this turn, deny with an instructive message
    // so the model knows to ask the user first. This is the hard enforcement layer
    // that works even if the model ignores the prompt instruction.
    //
    // EXCEPTION: Channel sessions have their own permission flow (the channel handler
    // sends an inline message to Telegram/Slack/etc. where the user approves). The
    // consent check is specifically for the UI modal path, not channel sessions.
    const bypassOn = permissionManager.getBypassPermissions();
    const isChannelSession = isChannelSessionId(sessionId) || host.getMessagingPermissionMode();
    if (!bypassOn && !isChannelSession) {
      const consentSet = host.getPendingToolConsent?.();
      if (consentSet && !consentSet.has(toolId)) {
        return {
          decision: 'deny',
          error: 'PERMISSION_INSTRUCTED',
          instruction: `Bypass mode is OFF. Ask the user for permission first via a normal inline question (e.g. "I need to use ${definition.name ?? toolId} to proceed. Should I go ahead?") before calling this tool. Do NOT call the tool again until the user says yes.`,
        };
      }
    }

    const permissionHandler = this.resolvePermissionRequestHandler(host, sessionId);
    // Never silently allow risky tools when a prompt is required but no UI/handler
    // is wired (e.g. crew voice call without a permission modal). Fail closed so
    // the agent receives an honest denial instead of a false success.
    if (!permissionHandler) {
      return { decision: 'deny', error: 'PERMISSION_DENIED' };
    }

    const integrationPreview = isIntegrationToolId(toolId)
      ? (buildIntegrationActionPreview(toolId, args, definition) ?? undefined)
      : undefined;

    host.getPermissionPromptHook()?.({
      toolId,
      path,
      riskLevel: definition.riskLevel,
      integrationPreview,
    });

    const response = await permissionHandler(toolId, path, definition.riskLevel, {
      args,
      integrationPreview,
    });

    const { decision, instruction } = normalizePermissionHandlerResult(response);

    if (decision === 'deny') {
      return {
        decision: 'deny',
        error: instruction ? 'PERMISSION_INSTRUCTED' : 'PERMISSION_DENIED',
        instruction,
      };
    }

    if (decision === 'allow_always') {
      host.getPermissionManager().grant(toolId, 'allow_always' as PermissionDecision, scopePath ?? undefined);
      return { decision: 'allow_always' };
    }

    return { decision: 'allow_once' };
  }

  private resolvePermissionRequestHandler(
    host: ToolPermissionHost,
    sessionId: string,
  ): PermissionRequestHandler | undefined {
    const channelHandler = host.getChannelPermissionRequestHandler();
    if (channelHandler && (isChannelSessionId(sessionId) || host.getMessagingPermissionMode())) {
      return channelHandler;
    }
    return host.getPermissionRequestHandler();
  }
}
