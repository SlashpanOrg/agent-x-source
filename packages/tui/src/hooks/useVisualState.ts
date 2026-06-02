import { useState, useEffect, useCallback, useRef } from 'react';
import type { VisualUpdate } from '@agentx/shared';
import { VisualStateManager } from '@agentx/engine';
import type { VisualState } from '@agentx/engine';

export function useVisualState(): {
  state: VisualState;
  reset: () => void;
} {
  const managerRef = useRef(new VisualStateManager());
  const [state, setState] = useState<VisualState>(() => managerRef.current.getState());

  useEffect(() => {
    const manager = managerRef.current;
    const unsubscribe = manager.subscribe(setState);
    return () => unsubscribe();
  }, []);

  const reset = useCallback(() => {
    managerRef.current.reset();
  }, []);

  return { state, reset };
}

/**
 * Hook that connects the VisualStateManager to an Agent's event bus.
 * Listens for `agent_message` events (emitted by VisualEventBridge) and feeds them.
 */
export function useVisualStateFromAgent(
  agent: { events: { on: (handler: (event: { type: string; message?: Record<string, unknown> }) => void) => () => void } } | null,
): {
  state: VisualState;
  reset: () => void;
} {
  const managerRef = useRef(new VisualStateManager());
  const [state, setState] = useState<VisualState>(() => managerRef.current.getState());

  useEffect(() => {
    if (!agent) return;
    const manager = managerRef.current;

    const unsubscribeState = manager.subscribe(setState);

    const unsubscribeEvents = agent.events.on((event) => {
      if (event.type === 'agent_message' && event.message) {
        // Attempt to apply as VisualUpdate
        const update = event.message as unknown as VisualUpdate;
        if (update && update.type) {
          manager.applyUpdate(update);
        }
      }
      // Also handle compaction events directly
      if (event.type === 'compaction_start') {
        manager.applyUpdate({ type: 'compaction_toast', action: 'start' });
      }
      if (event.type === 'compaction_complete') {
        manager.applyUpdate({ type: 'compaction_toast', action: 'done', details: 'Compacted' });
      }
      if (event.type === 'loading_end') {
        manager.reset();
      }
    });

    return () => {
      unsubscribeState();
      unsubscribeEvents();
    };
  }, [agent]);

  const reset = useCallback(() => {
    managerRef.current.reset();
  }, []);

  return { state, reset };
}
