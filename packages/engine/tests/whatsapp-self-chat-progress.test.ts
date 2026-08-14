import { describe, expect, it, vi } from 'vitest';
import type { QuestionnairePayload } from '@agentx/shared';
import {
  WhatsAppSelfChatProgress,
  checkingLine,
  chunkWhatsAppText,
  isStopCommand,
  ownerCallsign,
  parsePermissionReply,
  parseStepCapReply,
  whatsappLineForTool,
} from '../src/whatsapp/jarvis/self-chat-progress.js';

describe('self-chat progress phrases', () => {
  it('uses the owner callsign in the opening filler', () => {
    expect(checkingLine('Mitra')).toBe('Checking, Mitra.');
    expect(checkingLine('')).toBe('Checking, sir.');
    expect(ownerCallsign(undefined)).toBe('sir');
  });

  it('maps tools from events, not from the user query', () => {
    expect(whatsappLineForTool('web_search')).toBe('Browsing the internet.');
    expect(whatsappLineForTool('knowledge_base_search')).toBe('Accessing the knowledge base.');
    expect(whatsappLineForTool('cortex_memory_search')).toBe('Searching memory.');
    expect(whatsappLineForTool('shell_exec')).toBe('Running a command.');
    expect(whatsappLineForTool('todo_write')).toBeNull();
    expect(whatsappLineForTool('whatsapp_send_text')).toBeNull();
  });

  it('parses stop, permission, and step-cap replies', () => {
    expect(isStopCommand('stop')).toBe(true);
    expect(isStopCommand('what is gold')).toBe(false);
    expect(parsePermissionReply('yes')).toBe('allow_once');
    expect(parsePermissionReply('always')).toBe('allow_always');
    expect(parsePermissionReply('no')).toBe('deny');
    expect(parsePermissionReply('use the cheaper model')).toBeNull();
    expect(parseStepCapReply('continue')).toBe(true);
    expect(parseStepCapReply('stop')).toBe(false);
  });

  it('chunks long WhatsApp replies', () => {
    const chunks = chunkWhatsAppText('a'.repeat(8000), 3500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('').replace(/\s/g, '').length).toBe(8000);
  });
});

describe('WhatsAppSelfChatProgress', () => {
  it('acks immediately then announces distinct tools', async () => {
    const sent: string[] = [];
    const progress = new WhatsAppSelfChatProgress({
      callsign: 'Mitra',
      send: async (text) => { sent.push(text); },
      throttleMs: 0,
      heartbeatMs: 60_000,
    });
    await progress.start();
    progress.handleEngineEvent({ type: 'tool_executing', tool: 'web_search', description: 'prices', startTime: 1 });
    progress.handleEngineEvent({ type: 'tool_executing', tool: 'web_search', description: 'prices', startTime: 1 });
    progress.handleEngineEvent({ type: 'tool_executing', tool: 'knowledge_base_search', description: 'notes', startTime: 1 });
    await progress.flush();
    expect(sent[0]).toBe('Checking, Mitra.');
    expect(sent).toContain('Browsing the internet.');
    expect(sent).toContain('Accessing the knowledge base.');
    expect(sent.filter((l) => l === 'Browsing the internet.')).toHaveLength(1);
  });

  it('surfaces clarification and permission as WhatsApp asks', async () => {
    const sent: string[] = [];
    const progress = new WhatsAppSelfChatProgress({
      callsign: 'Mitra',
      send: async (text) => { sent.push(text); },
      throttleMs: 0,
    });
    const questionnaire: QuestionnairePayload = {
      id: 'q1',
      questions: [{ id: 'city', prompt: 'Which city?', type: 'text' }],
    };
    progress.handleEngineEvent({ type: 'clarification_required', questionnaire });
    progress.handleEngineEvent({
      type: 'permission_required',
      requestId: 'p1',
      tool: 'shell_exec',
      path: '/tmp',
      riskLevel: 'high',
    });
    await progress.flush();
    expect(progress.awaitingClarification).toBe(true);
    expect(progress.pendingPermission?.requestId).toBe('p1');
    expect(sent.some((l) => l.includes('Which city?'))).toBe(true);
    expect(sent.some((l) => l.includes('shell exec') && l.includes('yes, always, or no'))).toBe(true);
  });
});
