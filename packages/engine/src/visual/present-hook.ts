import type { VisualItem } from '@agentx/shared';

type PresentFn = (item: VisualItem) => void;

let hook: PresentFn | null = null;

export function setVisualPresentHook(fn: PresentFn | null): void {
  hook = fn;
}

export function notifyVisualPresent(item: VisualItem): void {
  try {
    hook?.(item);
  } catch {
    /* UI hook is best-effort */
  }
}
