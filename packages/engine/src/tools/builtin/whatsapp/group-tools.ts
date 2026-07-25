/**
 * WhatsApp Group Tools (Phase 6.5).
 *
 * All group management operations require the 'groupManagement' capability.
 * The tools return a clear "not supported" error if the engine doesn't
 * support group management. Baileys implements all of these against its
 * multi-device socket API (groupCreate, groupMetadata, groupParticipantsUpdate,
 * groupUpdateSubject, groupUpdateDescription, groupLeave, groupAcceptInvite).
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

    if (!resolved.engine.createGroup) {
      return { success: false, output: 'This WhatsApp engine does not support group creation.', error: 'NOT_SUPPORTED' };
    }

    const { groupId } = await resolved.engine.createGroup(subject, participantsResult);
    return {
      success: true,
      output: `Group "${subject}" created. Group ID: ${groupId}. Participants invited: ${participantsResult.length}.`,
      metadata: { groupId, subject, participants: participantsResult },
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

    if (!resolved.engine.getGroupInfo) {
      return { success: false, output: 'This WhatsApp engine does not support fetching group info.', error: 'NOT_SUPPORTED' };
    }

    const info = await resolved.engine.getGroupInfo(groupId);
    const lines = [
      `Group: ${info.subject}`,
      `  ID: ${info.groupId}`,
      `  Participants: ${info.participants.length}${info.size ? ` (reported size: ${info.size})` : ''}`,
    ];
    if (info.owner) lines.push(`  Owner: ${info.owner}`);
    if (info.creation) lines.push(`  Created: ${new Date(info.creation * 1000).toISOString()}`);
    if (info.description) lines.push(`  Description: ${info.description}`);
    if (info.inviteCode) lines.push(`  Invite code: ${info.inviteCode}`);
    lines.push(`  Settings: ${info.announce ? 'admins-only messages' : 'all members can message'}, ${info.restrict ? 'admins-only edit' : 'all members can edit'}`);
    lines.push('  Participants:');
    for (const p of info.participants) {
      const role = p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : 'member';
      lines.push(`    - ${p.jid} (${role})`);
    }

    return {
      success: true,
      output: lines.join('\n'),
      metadata: { ...info },
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

    if (!resolved.engine.addParticipants) {
      return { success: false, output: 'This WhatsApp engine does not support adding participants.', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.addParticipants(groupId, participantsResult);
    return {
      success: true,
      output: `Added ${participantsResult.length} participant${participantsResult.length === 1 ? '' : 's'} to group ${groupId}.`,
      metadata: { groupId, participants: participantsResult },
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

    if (!resolved.engine.removeParticipants) {
      return { success: false, output: 'This WhatsApp engine does not support removing participants.', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.removeParticipants(groupId, participantsResult);
    return {
      success: true,
      output: `Removed ${participantsResult.length} participant${participantsResult.length === 1 ? '' : 's'} from group ${groupId}.`,
      metadata: { groupId, participants: participantsResult },
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

    if (!resolved.engine.promoteParticipant) {
      return { success: false, output: 'This WhatsApp engine does not support promoting participants.', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.promoteParticipant(groupId, participant);
    return {
      success: true,
      output: `Promoted ${participant} to admin in group ${groupId}.`,
      metadata: { groupId, participant, action: 'promote' },
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

    if (!resolved.engine.demoteParticipant) {
      return { success: false, output: 'This WhatsApp engine does not support demoting participants.', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.demoteParticipant(groupId, participant);
    return {
      success: true,
      output: `Demoted ${participant} from admin to member in group ${groupId}.`,
      metadata: { groupId, participant, action: 'demote' },
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

    if (!resolved.engine.setGroupSubject) {
      return { success: false, output: 'This WhatsApp engine does not support changing group subject.', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.setGroupSubject(groupId, subject);
    return {
      success: true,
      output: `Group ${groupId} subject updated to "${subject}".`,
      metadata: { groupId, subject },
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

    if (!resolved.engine.setGroupDescription) {
      return { success: false, output: 'This WhatsApp engine does not support changing group description.', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.setGroupDescription(groupId, description);
    return {
      success: true,
      output: `Group ${groupId} description updated.`,
      metadata: { groupId, description },
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

    if (!resolved.engine.leaveGroup) {
      return { success: false, output: 'This WhatsApp engine does not support leaving groups.', error: 'NOT_SUPPORTED' };
    }

    await resolved.engine.leaveGroup(groupId);
    return {
      success: true,
      output: `Left group ${groupId}.`,
      metadata: { groupId },
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

    if (!resolved.engine.joinGroupByInvite) {
      return { success: false, output: 'This WhatsApp engine does not support joining groups by invite.', error: 'NOT_SUPPORTED' };
    }

    const { groupId } = await resolved.engine.joinGroupByInvite(inviteCode);
    return {
      success: true,
      output: `Joined group ${groupId} via invite code ${inviteCode}.`,
      metadata: { groupId, inviteCode },
    };
  });
}
