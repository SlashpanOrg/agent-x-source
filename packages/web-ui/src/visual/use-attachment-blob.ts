import { useEffect, useRef, useState } from 'react';
import { fetchAttachmentBlob } from './fetch-attachment-blob';

export function useAttachmentBlob(storageId: string | undefined, mimeHint?: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [mimeType, setMimeType] = useState<string | undefined>(mimeHint);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const revoke = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
    if (!storageId) {
      revoke();
      setBlobUrl(null);
      setBytes(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    revoke();
    setBlobUrl(null);
    setBytes(null);
    void fetchAttachmentBlob(storageId, mimeHint)
      .then(async (blob) => {
        if (cancelled) return;
        const type = blob.type || mimeHint || 'application/octet-stream';
        setMimeType(type);
        if (type === 'application/pdf') {
          setBytes(await blob.arrayBuffer());
        } else {
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setBlobUrl(url);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      revoke();
    };
  }, [storageId, mimeHint]);

  return { blobUrl, bytes, mimeType, error, loading };
}
