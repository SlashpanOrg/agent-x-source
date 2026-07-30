export type PromptSectionLayer = 'static' | 'dynamic' | 'category';

export interface PromptSection<T = unknown> {
  readonly key: string;
  readonly layer?: PromptSectionLayer;
  readonly load: () => T | Promise<T>;
  readonly render: (value: T) => string;
  readonly diff: (previous: T, current: T) => string | null;
  readonly removed?: (previous: T) => string;
}

export interface PromptSectionInventoryItem {
  readonly key: string;
  readonly layer: PromptSectionLayer;
  readonly length: number;
}

export interface LayeredGeneration {
  readonly staticPrefix: string;
  readonly categoryOverlay: string;
  readonly dynamicSuffix: string;
  readonly baseline: string;
  readonly sections: PromptSectionInventoryItem[];
}

export interface SourceSnapshot {
  readonly value: unknown;
  readonly removed?: string;
}

export interface Generation {
  readonly baseline: string;
  readonly snapshot: Record<string, SourceSnapshot>;
}

export interface Update {
  readonly text: string;
  readonly snapshot: Record<string, SourceSnapshot>;
}

export type ReconcileResult =
  | { readonly tag: 'unchanged' }
  | { readonly tag: 'updated'; readonly update: Update }
  | { readonly tag: 'replacement-needed'; readonly generation: Generation }
  | { readonly tag: 'replacement-blocked' };

export type ReplacementResult =
  | { readonly tag: 'replacement-ready'; readonly generation: Generation }
  | { readonly tag: 'replacement-blocked' };
