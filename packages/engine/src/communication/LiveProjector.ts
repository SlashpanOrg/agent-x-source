export class LiveProjector {
  private rawBuffer = '';
  private projectedBuffer = '';

  project(rawText: string): string {
    this.rawBuffer = rawText;
    this.projectedBuffer = this.stripInternalContent(rawText);
    return this.projectedBuffer;
  }

  getRawBuffer(): string {
    return this.rawBuffer;
  }

  getProjectedBuffer(): string {
    return this.projectedBuffer;
  }

  getBuffers(): { raw: string; projected: string } {
    return {
      raw: this.rawBuffer,
      projected: this.projectedBuffer,
    };
  }

  appendDelta(delta: string): void {
    this.rawBuffer += delta;
    this.projectedBuffer = this.stripInternalContent(this.rawBuffer);
  }

  reset(): void {
    this.rawBuffer = '';
    this.projectedBuffer = '';
  }

  private stripInternalContent(text: string): string {
    let result = text;

    // Strip directive tags: <directive>...</directive>
    result = result.replace(/<directive>[^]*?<\/directive>/g, '');

    // Strip silent context blocks: <silent>...</silent>
    result = result.replace(/<silent>[^]*?<\/silent>/g, '');

    // Strip internal XML tags: <agent_x_internal ...>...</agent_x_internal>
    result = result.replace(/<agent_x_internal[^>]*>[^]*?<\/agent_x_internal>/g, '');

    // Strip self-closing internal tags
    result = result.replace(/<agent_x_internal[^>]*\/>/g, '');

    return result;
  }

  static stripDirectives(text: string): string {
    return new LiveProjector().project(text);
  }
}
