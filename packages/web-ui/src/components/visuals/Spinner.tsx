import React, { useState, useEffect } from 'react';

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const Spinner: React.FC<{
  variant?: 'braille' | 'dots';
  color?: string;
  interval?: number;
  size?: number;
}> = ({ variant = 'braille', color = 'var(--ax-accent)', interval = 80, size = 16 }) => {
  const [frame, setFrame] = useState(0);
  const frames = variant === 'braille' ? BRAILLE : ['⠤', '⠤', '⠤'];

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, interval);
    return () => clearInterval(timer);
  }, [frames, interval]);

  return (
    <span style={{ color, fontSize: `${size}px`, fontFamily: 'monospace', display: 'inline-block', width: '1em', textAlign: 'center' }}>
      {frames[frame]}
    </span>
  );
};
