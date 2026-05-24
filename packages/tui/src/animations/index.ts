import { useState, useEffect } from 'react';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DOTS_FRAMES = ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'];
const BOUNCE_FRAMES = ['⠁', '⠂', '⠄', '⠂'];
const PULSE_FRAMES = ['░', '▒', '▓', '█', '▓', '▒', '░'];
const EARTH_FRAMES = ['🌍', '🌎', '🌏'];
const ARROWS_FRAMES = ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'];
const BLOCKS_FRAMES = ['▏', '▎', '▍', '▌', '▋', '▊', '▉', '█', '▉', '▊', '▋', '▌', '▍', '▎', '▏'];

export type AnimationType = 'spinner' | 'dots' | 'bounce' | 'pulse' | 'earth' | 'arrows' | 'blocks';

const FRAME_MAP: Record<AnimationType, string[]> = {
  spinner: SPINNER_FRAMES,
  dots: DOTS_FRAMES,
  bounce: BOUNCE_FRAMES,
  pulse: PULSE_FRAMES,
  earth: EARTH_FRAMES,
  arrows: ARROWS_FRAMES,
  blocks: BLOCKS_FRAMES,
};

/**
 * Hook: Animates through frames at a given interval.
 */
export function useAnimation(type: AnimationType = 'spinner', intervalMs = 80): string {
  const frames = FRAME_MAP[type];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [frames.length, intervalMs]);

  return frames[frame]!;
}

/**
 * Hook: Typewriter effect — reveals text character by character.
 */
export function useTypewriter(text: string, speed = 30): string {
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    setRevealed(0);
    if (!text) return;
    const timer = setInterval(() => {
      setRevealed((r) => {
        if (r >= text.length) {
          clearInterval(timer);
          return r;
        }
        return r + 1;
      });
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return text.slice(0, revealed);
}

/**
 * Hook: Fade-in text with a delay before showing.
 */
export function useFadeIn(visible: boolean, delayMs = 150): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => setShow(true), delayMs);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
    return;
  }, [visible, delayMs]);

  return show;
}

/**
 * Hook: Progress bar animation (0 to 1 over duration).
 */
export function useProgress(active: boolean, durationMs = 3000): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!active) {
      setProgress(0);
      return;
    }
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const p = Math.min(1, elapsed / durationMs);
      setProgress(p);
      if (p >= 1) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, [active, durationMs]);

  return progress;
}

/**
 * Hook: Blinking cursor effect.
 */
export function useBlinkingCursor(intervalMs = 530): string {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setVisible((v) => !v), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return visible ? '█' : ' ';
}

export { SPINNER_FRAMES, DOTS_FRAMES, BOUNCE_FRAMES, PULSE_FRAMES };
