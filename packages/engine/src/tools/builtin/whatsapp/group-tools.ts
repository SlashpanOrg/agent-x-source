/**
 * WhatsApp Group Tools (Phase 6.5).
 *
 * All group management operations require the 'groupManagement' capability.
 * The tools return a clear "not supported" error if the engine doesn't
 * support group management.
 *
 * Note: The IWhatsAppEngine interface doesn't currently have group management
 * methods beyond what's in the callbacks. These tools are defined with the
 * correct schemas and capability gating, but return NOT_IMPLEMENTED until
 * the engine interface is extended with group methods.
 */
import type { ToolResult, ToolExecutionContext } from '@agentx/shared';
import {
  requireEngineWithCapability,
  runTool,
  requireString,
  requireStringArray,
} from './helpers.js';

// ─── WhatsAppCreateGroup ─────────────────────────────────────────────────

export async function whatsappCreateGroup(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('create group', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const subject = requireString(args, 'subject');
    if (typeof subject !== "string") return subject;
    const participantsResult = requireStringArray(args, 'participants');
    if (!Array.isArray(participantsResult)) return participantsResult;

    return {
      success: false,
      output: 'Group creation is not yet implemented in the engine interface. This will be added when the group management methods are extended on IWhatsAppEngine.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppGetGroupInfo ────────────────────────────────────────────────

export async function whatsappGetGroupInfo(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('get group info', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const groupId = requireString(args, 'groupId');
    if (typeof groupId !== "string") return groupId;

    return {
      success: false,
      output: 'Getting group info is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppAddParticipants ─────────────────────────────────────────────

export async function whatsappAddParticipants(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('add participants', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const groupId = requireString(args, 'groupId');
    if (typeof groupId !== "string") return groupId;
    const participantsResult = requireStringArray(args, 'participants');
    if (!Array.isArray(participantsResult)) return participantsResult;

    return {
      success: false,
      output: 'Adding participants is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppRemoveParticipants ──────────────────────────────────────────

export async function whatsappRemoveParticipants(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('remove participants', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const groupId = requireString(args, 'groupId');
    if (typeof groupId !== "string") return groupId;
    const participantsResult = requireStringArray(args, 'participants');
    if (!Array.isArray(participantsResult)) return participantsResult;

    return {
      success: false,
      output: 'Removing participants is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppPromoteParticipant ──────────────────────────────────────────

export async function whatsappPromoteParticipant(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('promote participant', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const groupId = requireString(args, 'groupId');
    if (typeof groupId !== "string") return groupId;
    const participant = requireString(args, 'participant');
    if (typeof participant !== "string") return participant;

    return {
      success: false,
      output: 'Promoting participants is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppDemoteParticipant ───────────────────────────────────────────

export async function whatsappDemoteParticipant(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('demote participant', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const groupId = requireString(args, 'groupId');
    if (typeof groupId !== "string") return groupId;
    const participant = requireString(args, 'participant');
    if (typeof participant !== "string") return participant;

    return {
      success: false,
      output: 'Demoting participants is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppSetGroupSubject ─────────────────────────────────────────────

export async function whatsappSetGroupSubject(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('set group subject', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const groupId = requireString(args, 'groupId');
    if (typeof groupId !== "string") return groupId;
    const subject = requireString(args, 'subject');
    if (typeof subject !== "string") return subject;

    return {
      success: false,
      output: 'Setting group subject is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppSetGroupDescription ─────────────────────────────────────────

export async function whatsappSetGroupDescription(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('set group description', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const groupId = requireString(args, 'groupId');
    if (typeof groupId !== "string") return groupId;
    const description = requireString(args, 'description');
    if (typeof description !== "string") return description;

    return {
      success: false,
      output: 'Setting group description is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppLeaveGroup ──────────────────────────────────────────────────

export async function whatsappLeaveGroup(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('leave group', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const groupId = requireString(args, 'groupId');
    if (typeof groupId !== "string") return groupId;

    return {
      success: false,
      output: 'Leaving groups is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}

// ─── WhatsAppJoinGroupByInvite ───────────────────────────────────────────

export async function whatsappJoinGroupByInvite(
  args: Record<string, unknown>,
  _context: ToolExecutionContext,
): Promise<ToolResult> {
  return runTool('join group by invite', async () => {
    const resolved = requireEngineWithCapability('groupManagement');
    if ("error" in resolved) return resolved.error;

    const inviteCode = requireString(args, 'inviteCode');
    if (typeof inviteCode !== "string") return inviteCode;

    return {
      success: false,
      output: 'Joining groups by invite code is not yet implemented in the engine interface.',
      error: 'NOT_IMPLEMENTED',
    };
  });
}
