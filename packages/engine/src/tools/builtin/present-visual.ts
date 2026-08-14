import type { ToolExecutionContext, ToolResult } from '@agentx/shared';
import { buildVisualItem, isCrewVoiceSessionId, isVisualKind } from '@agentx/shared';
import { getAttachmentService } from '../../attachments/index.js';
import { notifyVisualPresent } from '../../visual/present-hook.js';

const VOICE_SESSION_ID = '__channel__:voice';

function isVoiceSurfaceSession(sessionId: string): boolean {
  return sessionId === VOICE_SESSION_ID || isCrewVoiceSessionId(sessionId);
}

export async function presentVisual(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
  const kindRaw = args['kind'];
  if (!isVisualKind(kindRaw)) {
    return { success: false, output: 'kind must be image, video, document, or url', error: 'INVALID_KIND' };
  }
  const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
  if (!title) {
    return { success: false, output: 'title is required', error: 'MISSING_INPUT' };
  }
  const storageId = typeof args['storageId'] === 'string' ? args['storageId'].trim() : undefined;
  const url = typeof args['url'] === 'string' ? args['url'].trim() : undefined;
  const caption = typeof args['caption'] === 'string' ? args['caption'].trim() : undefined;
  const mimeType = typeof args['mimeType'] === 'string' ? args['mimeType'].trim() : undefined;
  const attribution = typeof args['attribution'] === 'string' ? args['attribution'].trim() : undefined;

  if (kindRaw !== 'url') {
    if (!storageId) {
      return { success: false, output: 'storageId is required for image, video, and document', error: 'MISSING_INPUT' };
    }
    const stored = getAttachmentService().getAttachment(storageId);
    if (!stored) {
      return { success: false, output: `Attachment not found: ${storageId}`, error: 'NOT_FOUND' };
    }
  }

  const item = buildVisualItem({
    kind: kindRaw,
    title,
    storageId,
    url,
    caption,
    mimeType,
    attribution,
  });
  if (!item) {
    return { success: false, output: 'Could not build a visual item — check kind and source', error: 'INVALID_VISUAL' };
  }

  if (isVoiceSurfaceSession(context.sessionId)) {
    notifyVisualPresent(item);
  }

  return {
    success: true,
    output: kindRaw === 'url'
      ? (isVoiceSurfaceSession(context.sessionId)
        ? `Showing ${title} in the visual stage.`
        : `Showing ${title} as a link. Click to open in the browser.`)
      : `Showing ${title} (${kindRaw}).`,
    metadata: { visualItem: item },
  };
}
