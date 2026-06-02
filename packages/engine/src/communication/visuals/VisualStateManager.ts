import type {
  VisualUpdate,
  ToolCardProps,
  ThinkingPanelState,
} from '@agentx/shared';
import { StreamingMarkdownRenderer } from './StreamingMarkdownRenderer.js';

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

export class VisualStateManager {
  private renderer = new StreamingMarkdownRenderer();
  private state: VisualState = {
    streamingText: {
      stableHtml: '',
      unstableText: '',
      accumulatedText: '',
      isStreaming: false,
    },
    toolCards: { cards: new Map(), orderedIds: [] },
    thinkingPanel: {
      isActive: false,
      isExpanded: false,
      content: '',
      visibility: 'auto',
    },
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

      case 'tool_card': {
        const { id } = update.card;
        this.state.toolCards.cards.set(id, update.card);
        if (!this.state.toolCards.orderedIds.includes(id)) {
          this.state.toolCards.orderedIds.push(id);
        }
        this._notify();
        break;
      }

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
          message: update.action === 'done' ? (update.details ?? 'Compacted') : 'Compacting context...',
        };
        this._notify();
        break;

      case 'toast':
        this.state.errorToast = { message: update.message, icon: update.icon };
        this._notify();
        break;

      case 'spinner':
        // Handled by component-level spinner management
        break;

      case 'todo_update':
      case 'diff_preview':
        // These are handled by the existing TodoProgress and DiffView components
        break;
    }
  }

  reset(): void {
    this.renderer.reset();
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
