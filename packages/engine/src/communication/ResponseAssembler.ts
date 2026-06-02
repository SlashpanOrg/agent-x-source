import type {
  AgentXStreamEvent,
  FinalAssistantMessage,
  NormalizedToolCall,
  UsageInfo,
} from '@agentx/shared';
import { ToolCallStatus } from '@agentx/shared';

export class ResponseAssembler {
  private text = '';
  private reasoning = '';
  private toolCalls: NormalizedToolCall[] = [];
  private usage: UsageInfo = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  private stopReason = 'end_turn';
  private messageId = '';

  feed(event: AgentXStreamEvent): void {
    switch (event.type) {
      case 'text.start':
        this.messageId = event.messageId;
        break;

      case 'text.delta':
        this.text += event.delta;
        break;

      case 'text.end':
        break;

      case 'reasoning.start':
        break;

      case 'reasoning.delta':
        this.reasoning += event.delta;
        break;

      case 'reasoning.end':
        break;

      case 'tool.input.start':
        this.toolCalls.push({
          id: event.toolCallId,
          name: event.toolName,
          arguments: {},
          status: ToolCallStatus.INPUT_DONE,
        });
        break;

      case 'tool.input.delta': {
        const tool = this.toolCalls.find(
          (tc) => tc.id === event.toolCallId,
        );
        if (tool) {
          try {
            const parsed = JSON.parse(event.delta);
            tool.arguments = { ...tool.arguments, ...parsed };
          } catch {
            // Partial args - accumulate as _raw
            if (!tool.arguments._raw) {
              tool.arguments._raw = '';
            }
            (tool.arguments as Record<string, unknown>)._raw += event.delta;
          }
        }
        break;
      }

      case 'tool.input.end': {
        const tool = this.toolCalls.find(
          (tc) => tc.id === event.toolCallId,
        );
        if (tool) {
          tool.status = ToolCallStatus.INPUT_DONE;
        }
        break;
      }

      case 'tool.execute.start':
        break;

      case 'tool.execute.progress':
        break;

      case 'tool.execute.end': {
        const tool = this.toolCalls.find(
          (tc) => tc.id === event.toolCallId,
        );
        if (tool) {
          tool.status = event.ok ? ToolCallStatus.COMPLETED : ToolCallStatus.ERROR;
          tool.durationMs = event.durationMs;
        }
        break;
      }

      case 'turn.end':
        this.usage = event.usage;
        this.stopReason = event.stopReason;
        break;

      default:
        break;
    }
  }

  assemble(): FinalAssistantMessage {
    return {
      messageId:
        this.messageId || `msg-${Date.now()}`,
      text: this.text,
      reasoning: this.reasoning || undefined,
      toolCalls: this.toolCalls,
      usage: this.usage,
      stopReason: this.stopReason,
    };
  }

  reset(): void {
    this.text = '';
    this.reasoning = '';
    this.toolCalls = [];
    this.usage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    this.stopReason = 'end_turn';
    this.messageId = '';
  }
}
