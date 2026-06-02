import { describe, it, expect } from 'vitest';
import { LiveProjector } from '../src/communication/LiveProjector.js';

describe('LiveProjector', () => {
  const projector = new LiveProjector();

  it('strips directive tags from text', () => {
    const raw = 'Hello<directive>use tool</directive> world';
    const result = projector.project(raw);

    expect(result).toBe('Hello world');
  });

  it('strips silent context blocks', () => {
    const raw = 'Start<silent>system message</silent>End';
    const result = projector.project(raw);

    expect(result).toBe('StartEnd');
  });

  it('strips internal XML tags', () => {
    const raw = 'Text<agent_x_internal key="value">secret</agent_x_internal>Done';
    const result = projector.project(raw);

    expect(result).toBe('TextDone');
  });

  it('preserves normal text', () => {
    const raw = 'This is a normal response from the assistant';
    const result = projector.project(raw);

    expect(result).toBe(raw);
  });

  it('accumulates deltas and projects correctly', () => {
    const proj = new LiveProjector();
    proj.appendDelta('Hello');
    proj.appendDelta('<directive>internal</directive>');
    proj.appendDelta(' World');

    expect(proj.getProjectedBuffer()).toBe('Hello World');
    expect(proj.getRawBuffer()).toContain('<directive>');
  });

  it('resets buffers', () => {
    projector.appendDelta('text');
    projector.reset();

    expect(projector.getRawBuffer()).toBe('');
    expect(projector.getProjectedBuffer()).toBe('');
  });
});
