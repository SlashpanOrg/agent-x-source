import type {
  AgentXStreamEvent,
  VisualUpdate,
  ToolCardProps,
  ThinkingPanelState,
  SpinnerConfig,
} from '@agentx/shared';
import { DEFAULT_TOOL_DISPLAY } from '@agentx/shared';
import { StreamingMarkdownRenderer } from './StreamingMarkdownRenderer.js';

export class VisualEventBridge {
  private markdownRenderer = new StreamingMarkdownRenderer();
  private toolCards = new Map<string, ToolCardProps>();
  private accumulatedText = '';
  private accumulatedReasoning = '';
  private thinkingState: ThinkingPanelState = {
    isActive: false,
    isExpanded: true,
    content: '',
    visibility: 'auto',
  };
  private lastBroadcast = 0;
  private baseThrottleMs: number;
  private _isScrolling = false;
  private _isTyping = false;

  // Dynamic throttle: 80ms typing, 96ms scrolling, 150ms default
  private static readonly THROTTLE_TYPING = 80;
  private static readonly THROTTLE_SCROLLING = 96;
  private static readonly THROTTLE_DEFAULT = 150;

  constructor(throttleMs: number = VisualEventBridge.THROTTLE_DEFAULT) {
    this.baseThrottleMs = throttleMs;
  }

  setScrolling(active: boolean): void {
    this._isScrolling = active;
  }

  setTyping(active: boolean): void {
    this._isTyping = active;
  }

  private get effectiveThrottle(): number {
    if (this._isScrolling) return VisualEventBridge.THROTTLE_SCROLLING;
    if (this._isTyping) return VisualEventBridge.THROTTLE_TYPING;
    return this.baseThrottleMs;
  }

  handleEvent(event: AgentXStreamEvent): VisualUpdate | null {
    switch (event.type) {
      case 'text.start':
        this.accumulatedText = '';
        this.markdownRenderer.reset();
        return null;

      case 'text.delta':
        return this._handleTextDelta(event);

      case 'text.end':
        return null;

      case 'reasoning.start':
        this.accumulatedReasoning = '';
        this.thinkingState.isActive = true;
        this.thinkingState.startTime = event.ts;
        return {
          type: 'thinking_update',
          state: { isActive: true, content: '', isExpanded: true },
        };

      case 'reasoning.delta':
        this.accumulatedReasoning += event.delta;
        return {
          type: 'thinking_update',
          state: { isActive: true, content: this.accumulatedReasoning },
        };

      case 'reasoning.end':
        this.thinkingState.isActive = false;
        return {
          type: 'thinking_update',
          state: { isActive: false, content: this.accumulatedReasoning },
        };

      case 'tool.input.start': {
        const display = DEFAULT_TOOL_DISPLAY[event.toolName] ?? {
          icon: '🔧',
          label: event.toolName,
          color: '#90A4AE',
        };
        const card: ToolCardProps = {
          id: event.toolCallId,
          name: event.toolName,
          icon: display.icon,
          label: display.label,
          status: 'pending',
          isExpanded: false,
        };
        this.toolCards.set(event.toolCallId, card);
        return { type: 'tool_card', card };
      }

      case 'tool.input.delta': {
        const card = this.toolCards.get(event.toolCallId);
        if (card) {
          card.input = (card.input ?? '') + event.delta;
          card.status = 'running';
        }
        return null;
      }

      case 'tool.input.end':
        return null;

      case 'tool.execute.start': {
        const card = this.toolCards.get(event.toolCallId);
        if (card) {
          card.status = 'running';
          return { type: 'tool_card_update', card: { id: event.toolCallId, status: 'running' } };
        }
        return null;
      }

      case 'tool.execute.progress': {
        const card = this.toolCards.get(event.toolCallId);
        if (card) {
          card.detail = event.message;
          return { type: 'tool_card_update', card: { id: event.toolCallId, detail: event.message } };
        }
        return null;
      }

      case 'tool.execute.end': {
        const card = this.toolCards.get(event.toolCallId);
        if (card) {
          card.status = event.ok ? 'completed' : 'error';
          card.durationMs = event.durationMs;
          if (!event.ok) card.error = `Tool execution failed`;
          return { type: 'tool_card_update', card };
        }
        return null;
      }

      case 'compaction.start':
        return { type: 'compaction_toast', action: 'start' };

      case 'compaction.end':
        return { type: 'compaction_toast', action: 'done', details: `Saved ${event.tokensSaved} tokens` };

      case 'turn.end':
        this.accumulatedText = '';
        this.markdownRenderer.reset();
        this.toolCards.clear();
        return null;

      case 'turn.error':
        return {
          type: 'toast',
          message: event.message,
          icon: '✗',
          autoDismiss: 5000,
        };

      case 'provider.error':
        return {
          type: 'toast',
          message: `Provider error: ${event.message}`,
          icon: '⚠',
          autoDismiss: 8000,
        };

      default:
        return null;
    }
  }

  private _handleTextDelta(
    event: Extract<AgentXStreamEvent, { type: 'text.delta' }>,
  ): VisualUpdate | null {
    this.accumulatedText += event.delta;

    const now = Date.now();
    const threshold = this.effectiveThrottle;
    if (now - this.lastBroadcast < threshold) return null;
    this.lastBroadcast = now;

    const state = this.markdownRenderer.render(this.accumulatedText);

    return {
      type: 'text_update',
      messageId: event.messageId,
      stableHtml: state.stableHtml,
      unstableText: state.unstableText,
    };
  }

  /** Create a spinner visual update */
  createSpinner(id: string, show: boolean): VisualUpdate {
    return {
      type: 'spinner',
      id,
      config: {
        variant: 'braille',
        speed: 80,
        color: 'accent',
      } satisfies SpinnerConfig,
      show,
    };
  }

  reset(): void {
    this.accumulatedText = '';
    this.accumulatedReasoning = '';
    this.markdownRenderer.reset();
    this.toolCards.clear();
    this.thinkingState = {
      isActive: false,
      isExpanded: true,
      content: '',
      visibility: 'auto',
    };
  }
}
