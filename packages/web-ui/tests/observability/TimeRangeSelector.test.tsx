// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeRangeSelector } from '../../src/observability/components/TimeRangeSelector.js';

describe('TimeRangeSelector', () => {
  it('renders preset buttons', () => {
    const value = { preset: '1h' as const, from: new Date(Date.now() - 3600000).toISOString(), to: new Date().toISOString() };
    render(<TimeRangeSelector value={value} onChange={() => {}} />);
    expect(screen.getByText('15m')).toBeTruthy();
    expect(screen.getByText('1h')).toBeTruthy();
    expect(screen.getByText('24h')).toBeTruthy();
  });

  it('calls onChange when a preset is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const value = { preset: '1h' as const, from: new Date(Date.now() - 3600000).toISOString(), to: new Date().toISOString() };
    render(<TimeRangeSelector value={value} onChange={onChange} />);
    await act(async () => {
      await user.click(screen.getByText('15m'));
    });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0]![0].preset).toBe('15m');
  });
});
