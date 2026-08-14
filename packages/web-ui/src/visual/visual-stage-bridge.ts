import type { VisualItem } from '@agentx/shared/browser';

export interface VisualStageBridge {
  open: (item: VisualItem) => void;
  close: () => void;
}

let bridge: VisualStageBridge | null = null;

export function bindVisualStage(next: VisualStageBridge | null): void {
  bridge = next;
}

export function openVisualFromVoice(item: VisualItem): void {
  bridge?.open(item);
}

export function closeVisualFromVoice(): void {
  bridge?.close();
}
