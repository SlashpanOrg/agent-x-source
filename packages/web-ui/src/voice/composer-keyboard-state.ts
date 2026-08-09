/** Shared composer focus/empty state for voice Space-key handling (updated by ChatInputBar). */
let composerFocused = false;
let composerEmpty = true;

export function setComposerKeyboardState(state: { focused: boolean; empty: boolean }): void {
  composerFocused = state.focused;
  composerEmpty = state.empty;
}

export function getComposerKeyboardState(): { focused: boolean; empty: boolean } {
  return { focused: composerFocused, empty: composerEmpty };
}

function nodeIsContentEditable(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const attr = el.getAttribute('contenteditable');
  return attr !== null && attr !== 'false';
}

/** True when Space should insert text instead of triggering voice push-to-talk. */
export function isEditableTypingTarget(target: EventTarget | null): boolean {
  let el: HTMLElement | null = null;
  if (target instanceof HTMLElement) {
    el = target;
  } else if (target instanceof Node && target.nodeType === Node.TEXT_NODE) {
    el = target.parentElement;
  }

  while (el) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return !el.disabled && !el.readOnly;
    }
    if (nodeIsContentEditable(el)) return true;
    el = el.parentElement;
  }
  return false;
}
