import { attachments as attachmentsApi, getAuthToken } from '../api';

/** Authenticated binary fetch — bare <img>/<video> URLs omit Bearer and fail in Electron. */
export async function fetchAttachmentBlob(attachmentId: string, mimeHint?: string): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(attachmentsApi.get(attachmentId), {
    credentials: 'include',
    headers,
  });
  if (res.status === 401) throw new Error('Unauthorized');
  if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
  const buffer = await res.arrayBuffer();
  const headerType = res.headers.get('content-type')?.split(';')[0]?.trim();
  const type = (
    (mimeHint && mimeHint !== 'application/octet-stream' && mimeHint)
    || (headerType && headerType !== 'application/octet-stream' && headerType)
    || mimeHint
    || headerType
    || 'application/octet-stream'
  );
  return new Blob([buffer], { type });
}
