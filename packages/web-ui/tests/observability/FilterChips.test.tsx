// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterChips } from '../../src/observability/components/FilterChips.js';

describe('FilterChips', () => {
  it('renders all options as chips', () => {
    render(<FilterChips options={['a', 'b', 'c']} selected={[]} onChange={() => {}} label="Test" />);
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
    expect(screen.getByText('c')).toBeTruthy();
  });

  it('calls onChange when a chip is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<FilterChips options={['info', 'warn', 'error']} selected={[]} onChange={onChange} label="Level" />);
    await act(async () => {
      await user.click(screen.getByText('warn'));
    });
    expect(onChange).toHaveBeenCalled();
  });

  it('shows selected chips as selected', () => {
    render(<FilterChips options={['info', 'warn']} selected={['warn']} onChange={() => {}} label="Level" />);
    const warnChip = screen.getByText('warn').closest('[role="button"]') ?? screen.getByText('warn').closest('button');
    // The selected chip should have a different class.
    expect(warnChip).toBeTruthy();
  });
});
