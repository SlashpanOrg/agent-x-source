import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { VisualItem } from '@agentx/shared/browser';
import { VisualStageModal } from '../../visual/VisualStageModal';
import { bindVisualStage } from '../../visual/visual-stage-bridge';

interface VisualStageValue {
  open: (item: VisualItem) => void;
  close: () => void;
  peekLast: () => VisualItem | null;
  current: VisualItem | null;
  visible: boolean;
}

const VisualStageContext = createContext<VisualStageValue | null>(null);

export function useVisualStage(): VisualStageValue {
  const ctx = useContext(VisualStageContext);
  if (!ctx) throw new Error('useVisualStage must be used within VisualStageProvider');
  return ctx;
}

export function useVisualStageOptional(): VisualStageValue | null {
  return useContext(VisualStageContext);
}

export function VisualStageProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<VisualItem | null>(null);
  const [last, setLast] = useState<VisualItem | null>(null);
  const [visible, setVisible] = useState(false);

  const open = useCallback((item: VisualItem) => {
    setCurrent(item);
    setLast(item);
    setVisible(true);
  }, []);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const peekLast = useCallback(() => last, [last]);

  useEffect(() => {
    bindVisualStage({ open, close });
    return () => bindVisualStage(null);
  }, [open, close]);

  const value = useMemo<VisualStageValue>(() => ({
    open,
    close,
    peekLast,
    current,
    visible,
  }), [open, close, peekLast, current, visible]);

  return (
    <VisualStageContext.Provider value={value}>
      {children}
      <VisualStageModal open={visible} item={current} onClose={close} />
    </VisualStageContext.Provider>
  );
}
