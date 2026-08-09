import { useEffect, useRef } from 'react';
import { getComposerKeyboardState, isEditableTypingTarget } from '../voice/composer-keyboard-state';
import { shouldBeginPushToTalkOnSpace, shouldEndPushToTalkOnSpace } from '../voice/wake-phrase';

const DOUBLE_TAP_SPACE_MS = 350;

export function useVoiceKeyboard(options: {
  enabled: boolean;
  /** When true, Space push-to-talk works without chat composer focus (inline chat voice). */
  globalSpace?: boolean;
  composerFocused: boolean;
  composerEmpty: boolean;
  pushToTalk: boolean;
  /** Block Space push-to-talk while agent turn is in flight. */
  pushToTalkBlocked?: boolean;
  onBeginPushToTalk: () => void;
  onEndPushToTalk: () => void;
  onToggleSession: () => void;
  onInterruptPlayback: () => void;
  /** Two quick Space presses toggle push-to-talk ↔ hands-free. */
  onDoubleTapSpace?: () => void;
}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const lastSpaceDownRef = useRef(0);
  const spacePttHeldRef = useRef(false);

  useEffect(() => {
    if (!options.enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const opts = optionsRef.current;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        opts.onToggleSession();
        return;
      }
      if (event.key === 'Escape') {
        spacePttHeldRef.current = false;
        opts.onInterruptPlayback();
        if (opts.pushToTalk) opts.onEndPushToTalk();
        return;
      }
      if (event.key === ' ' || event.code === 'Space') {
        const composer = getComposerKeyboardState();
        const inEditable = isEditableTypingTarget(event.target);

        if (event.repeat) {
          if (spacePttHeldRef.current) {
            event.preventDefault();
            event.stopPropagation();
          } else if (opts.globalSpace && !inEditable) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }

        // Never steal Space from text inputs — except empty focused composer PTT.
        if (inEditable) {
          const emptyComposerPtt =
            opts.pushToTalk &&
            !opts.pushToTalkBlocked &&
            composer.focused &&
            composer.empty;
          if (emptyComposerPtt) {
            event.preventDefault();
            event.stopPropagation();
            spacePttHeldRef.current = true;
            opts.onBeginPushToTalk();
          }
          return;
        }

        // When globalSpace is active (dashboard voice card / inline voice / call),
        // always prevent default to avoid page scrolling — even if push-to-talk
        // is blocked or the engine is still warming up.
        if (opts.globalSpace) {
          event.preventDefault();
          event.stopPropagation();
        }

        const now = Date.now();
        if (opts.onDoubleTapSpace && now - lastSpaceDownRef.current < DOUBLE_TAP_SPACE_MS) {
          event.preventDefault();
          event.stopPropagation();
          lastSpaceDownRef.current = 0;
          opts.onDoubleTapSpace();
          return;
        }
        lastSpaceDownRef.current = now;

        if (
          opts.pushToTalk &&
          !opts.pushToTalkBlocked &&
          shouldBeginPushToTalkOnSpace({
            globalSpace: opts.globalSpace,
            composerFocused: composer.focused,
            composerEmpty: composer.empty,
            repeat: false,
          })
        ) {
          spacePttHeldRef.current = true;
          opts.onBeginPushToTalk();
          return;
        }
        return;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const opts = optionsRef.current;
      if (event.key !== ' ' && event.code !== 'Space') return;
      const composer = getComposerKeyboardState();
      const inEditable = isEditableTypingTarget(event.target);

      if (
        opts.pushToTalk &&
        spacePttHeldRef.current &&
        shouldEndPushToTalkOnSpace({
          globalSpace: opts.globalSpace,
          composerFocused: composer.focused,
        })
      ) {
        event.preventDefault();
        event.stopPropagation();
        spacePttHeldRef.current = false;
        opts.onEndPushToTalk();
      } else if (opts.globalSpace && !inEditable) {
        // Prevent page scroll / button activation on keyup too.
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [options.enabled]);
}
