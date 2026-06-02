import { describe, it, expect } from 'vitest';
import { ToolArgsRepairer } from '../src/communication/ToolArgsRepairer.js';

describe('ToolArgsRepairer', () => {
  const repairer = new ToolArgsRepairer();

  it('passes valid JSON through', () => {
    const result = repairer.repairJSON('{"key": "value"}');
    expect(result.json).toEqual({ key: 'value' });
    expect(result.repairs).toHaveLength(0);
  });

  it('fixes Python None to null', () => {
    const result = repairer.repairJSON('{"key": None}');
    expect(result.json).toEqual({ key: null });
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it('fixes Python True to true', () => {
    const result = repairer.repairJSON('{"flag": True}');
    expect(result.json).toEqual({ flag: true });
  });

  it('fixes trailing commas in objects', () => {
    const result = repairer.repairJSON('{"a": 1,}');
    expect(result.json).toEqual({ a: 1 });
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it('fixes trailing commas in arrays', () => {
    const result = repairer.repairJSON('[1, 2, 3,]');
    expect(result.json).toEqual([1, 2, 3]);
  });

  it('closes unclosed braces', () => {
    const result = repairer.repairJSON('{"key": "value"');
    expect(result.json).toEqual({ key: 'value' });
  });

  it('strips invalid control characters from strings', () => {
    const result = repairer.repairJSON('{"text": "val\bue"}');
    expect(result.json).toEqual({ text: 'value' });
  });
});
