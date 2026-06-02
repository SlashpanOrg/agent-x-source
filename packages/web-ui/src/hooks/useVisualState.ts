import { useState, useEffect, useCallback, useRef } from 'react';

// Local type definitions (avoiding @agentx/shared dependency for browser bundle)
export interface ToolCardProps {
  id: string;
  name: string;
  icon: string;
  label: string;
  detail?: string;
  status: string;
  input?: string;
  output?: string;
  error?: string;
  durationMs?: number;
  isExpanded: boolean;
}

export interface ThinkingPanelState {
  isActive: boolean;
  isExpanded: boolean;
  content: string;
  title?: string;
  visibility: string;
  startTime?: number;
}

export type VisualUpdate =
  | { type: 'text_update'; messageId: string; stableHtml: string; unstableText: string }
  | { type: 'tool_card'; card: ToolCardProps }
  | { type: 'tool_card_update'; card: Partial<ToolCardProps> & { id: string } }
  | { type: 'thinking_update'; state: Partial<ThinkingPanelState> & { isActive: boolean } }
  | { type: 'todo_update'; items: Array<{ id: number; title: string; status: string }> }
  | { type: 'spinner'; id: string; config: { variant: string; speed: number; color: string }; show: boolean }
  | { type: 'toast'; message: string; icon: string; autoDismiss?: number }
  | { type: 'diff_preview'; filePath: string; diff: string; oldContent?: string; newContent?: string }
  | { type: 'compaction_toast'; action: 'start' | 'done'; details?: string };

export interface StreamingTextState {
  stableHtml: string;
  unstableText: string;
  accumulatedText: string;
  isStreaming: boolean;
}

export interface ToolCardMap {
  cards: Map<string, ToolCardProps>;
  orderedIds: string[];
}

export interface VisualState {
  streamingText: StreamingTextState;
  toolCards: ToolCardMap;
  thinkingPanel: ThinkingPanelState;
  compactionToast: { active: boolean; message: string } | null;
  errorToast: { message: string; icon: string } | null;
}

class LightweightVisualStateManager {
  private state: VisualState = {
    streamingText: { stableHtml: '', unstableText: '', accumulatedText: '', isStreaming: false },
    toolCards: { cards: new Map(), orderedIds: [] },
    thinkingPanel: { isActive: false, isExpanded: false, content: '', visibility: 'auto' },
    compactionToast: null,
    errorToast: null,
  };
  private listeners = new Set<(state: VisualState) => void>();

  subscribe(listener: (state: VisualState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): VisualState {
    return this.state;
  }

  applyUpdate(update: VisualUpdate): void {
    switch (update.type) {
      case 'text_update':
        this.state.streamingText.isStreaming = true;
        this.state.streamingText.stableHtml = update.stableHtml;
        this.state.streamingText.unstableText = update.unstableText;
        this._notify();
        break;
      case 'tool_card':
        this.state.toolCards.cards.set(update.card.id, update.card);
        if (!this.state.toolCards.orderedIds.includes(update.card.id)) {
          this.state.toolCards.orderedIds.push(update.card.id);
        }
        this._notify();
        break;
      case 'tool_card_update': {
        const existing = this.state.toolCards.cards.get(update.card.id);
        if (existing) {
          Object.assign(existing, update.card);
          this._notify();
        }
        break;
      }
      case 'thinking_update':
        Object.assign(this.state.thinkingPanel, update.state);
        this._notify();
        break;
      case 'compaction_toast':
        this.state.compactionToast = {
          active: update.action === 'start',
          message: update.action === 'done' ? (update.details ?? 'Compacted') : 'Compacting...',
        };
        this._notify();
        break;
      case 'toast':
        this.state.errorToast = { message: update.message, icon: update.icon };
        this._notify();
        break;
      default:
        break;
    }
  }

  reset(): void {
    this.state = {
      streamingText: { stableHtml: '', unstableText: '', accumulatedText: '', isStreaming: false },
      toolCards: { cards: new Map(), orderedIds: [] },
      thinkingPanel: { isActive: false, isExpanded: false, content: '', visibility: 'auto' },
      compactionToast: null,
      errorToast: null,
    };
    this._notify();
  }

  private _notify(): void {
    const snapshot = { ...this.state };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function useVisualState(): {
  state: VisualState;
  reset: () => void;
} {
  const managerRef = useRef(new LightweightVisualStateManager());
  const [state, setState] = useState<VisualState>(() => managerRef.current.getState());

  useEffect(() => {
    const manager = managerRef.current;
    const unsubscribe = manager.subscribe(setState);
    return () => unsubscribe();
  }, []);

  const reset = useCallback(() => managerRef.current.reset(), []);

  return { state, reset };
}

export function useVisualStateFromEvents(
  eventSource: (handler: (update: VisualUpdate) => void) => () => void,
): {
  state: VisualState;
  reset: () => void;
} {
  const managerRef = useRef(new LightweightVisualStateManager());
  const [state, setState] = useState<VisualState>(() => managerRef.current.getState());

  useEffect(() => {
    const manager = managerRef.current;
    const unsubscribeState = manager.subscribe(setState);
    const unsubscribeEvents = eventSource((update) => manager.applyUpdate(update));
    return () => { unsubscribeState(); unsubscribeEvents(); };
  }, [eventSource]);

  const reset = useCallback(() => managerRef.current.reset(), []);

  return { state, reset };
}
