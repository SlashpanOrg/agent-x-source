import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

const BRAILLE = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const Spinner: React.FC<{
  variant?: 'braille' | 'dots';
  color?: string;
  interval?: number;
}> = ({ variant = 'braille', color = '#58a6ff', interval = 80 }) => {
  const [frame, setFrame] = useState(0);
  const frames = variant === 'braille' ? BRAILLE : ['.  ', '.. ', '...', ' ..', '  .', '   '];

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, interval);
    return () => clearInterval(timer);
  }, [frames, interval]);

  return <Text color={color}>{frames[frame]}</Text>;
};
