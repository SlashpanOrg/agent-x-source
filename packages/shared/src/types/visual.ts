export type VisualKind = 'image' | 'video' | 'document' | 'url';

export type VisualSource =
  | { storageId: string; url?: never }
  | { url: string; storageId?: never };

export interface VisualItem {
  id: string;
  kind: VisualKind;
  title: string;
  caption?: string;
  mimeType?: string;
  source: VisualSource;
  attribution?: string;
}

export const VISUAL_KINDS: readonly VisualKind[] = ['image', 'video', 'document', 'url'];
