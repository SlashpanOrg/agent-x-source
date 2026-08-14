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
  const storageId = typeof args['storageId'] === 'string'
    ? args['storageId'].trim()
    : typeof args['storage_id'] === 'string' ? args['storage_id'].trim() : undefined;
  const urlRaw = typeof args['url'] === 'string' ? args['url'].trim()
    : typeof args['href'] === 'string' ? args['href'].trim()
    : typeof args['image_url'] === 'string' ? args['image_url'].trim()
    : typeof args['imageUrl'] === 'string' ? args['imageUrl'].trim()
    : typeof args['src'] === 'string' ? args['src'].trim()
    : undefined;
  const caption = typeof args['caption'] === 'string' ? args['caption'].trim() : undefined;
  const mimeType = typeof args['mimeType'] === 'string' ? args['mimeType'].trim() : undefined;
  const attribution = typeof args['attribution'] === 'string' ? args['attribution'].trim() : undefined;

  if (kindRaw !== 'url') {
    if (!storageId && !urlRaw) {
      return { success: false, output: 'storageId or url is required for image, video, and document', error: 'MISSING_INPUT' };
    }
    if (storageId) {
      const stored = getAttachmentService().getAttachment(storageId);
      if (!stored) {
        return { success: false, output: `Attachment not found: ${storageId}`, error: 'NOT_FOUND' };
      }
    }
  } else if (!urlRaw) {
    return { success: false, output: 'url is required for kind=url', error: 'MISSING_INPUT' };
  }

  const item = buildVisualItem({
    kind: kindRaw,
    title,
    storageId: storageId || undefined,
    url: urlRaw,
    caption,
    mimeType,
    attribution,
  });
  if (!item) {
    return { success: false, output: 'Could not build a visual item — check kind and source', error: 'INVALID_VISUAL' };
  }

  const onVoice = isVoiceSurfaceSession(context.sessionId) || Boolean(context.voiceTurn);
  if (onVoice) {
    notifyVisualPresent(item);
  }

  return {
    success: true,
    output: item.kind === 'url'
      ? (onVoice
        ? `Showing ${title} in the visual stage.`
        : `Showing ${title} as a link. Click to open in the browser.`)
      : `Showing ${title} (${item.kind}).`,
    metadata: { visualItem: item },
  };
}
