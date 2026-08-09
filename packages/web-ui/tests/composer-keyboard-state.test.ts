// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  getComposerKeyboardState,
  isEditableTypingTarget,
  setComposerKeyboardState,
} from '../src/voice/composer-keyboard-state';

describe('composer keyboard state', () => {
  it('tracks focus and empty from chat composer', () => {
    setComposerKeyboardState({ focused: true, empty: false });
    expect(getComposerKeyboardState()).toEqual({ focused: true, empty: false });
  });
});

describe('isEditableTypingTarget', () => {
  it('detects contenteditable and native inputs', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);

    expect(isEditableTypingTarget(div)).toBe(true);

    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isEditableTypingTarget(input)).toBe(true);

    div.remove();
    input.remove();
  });
});
