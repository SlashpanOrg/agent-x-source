import type { StreamingMarkdownState } from '@agentx/shared';

export class StreamingMarkdownRenderer {
  private stablePrefix = '';
  private stableBoundary = 0;

  render(text: string): StreamingMarkdownState {
    const boundary = this.findStableBoundary(text);

    if (boundary > this.stableBoundary) {
      this.stablePrefix = text.slice(0, boundary);
      this.stableBoundary = boundary;
    }

    return {
      stablePrefix: this.stablePrefix,
      unstableSuffix: text.slice(this.stableBoundary),
      stableHtml: this.stablePrefix,
      unstableText: text.slice(this.stableBoundary),
      boundaryPosition: this.stableBoundary,
    };
  }

  reset(): void {
    this.stablePrefix = '';
    this.stableBoundary = 0;
  }

  private findStableBoundary(text: string): number {
    let fenceDepth = 0;
    let mathDepth = 0;

    const pairs: Array<[string, string]> = [
      ['```', '```'],
      ['$$', '$$'],
      ['\\[', '\\]'],
    ];

    function isFenceAt(t: string, pos: number, marker: string): boolean {
      return t.slice(pos, pos + marker.length) === marker;
    }

    for (let i = text.length - 1; i >= 1; i--) {
      const char = text[i];
      const prev = text[i - 1];

      if (prev === '\n' && char === '\n' && fenceDepth === 0 && mathDepth === 0) {
        return i + 1;
      }

      for (const [open, close] of pairs) {
        if (isFenceAt(text, i, close)) {
          if (close === '```') {
            fenceDepth = fenceDepth > 0 ? fenceDepth - 1 : fenceDepth + 1;
          } else {
            mathDepth = mathDepth > 0 ? mathDepth - 1 : mathDepth + 1;
          }
        }
        if (isFenceAt(text, i, open)) {
          // Already handled by the close detection
        }
      }
    }

    return 0;
  }
}
