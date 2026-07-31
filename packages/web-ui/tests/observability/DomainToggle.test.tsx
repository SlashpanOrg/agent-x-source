// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DomainToggle } from '../../src/observability/components/DomainToggle.js';

describe('DomainToggle', () => {
  it('renders three segments (Agent, App, Both)', () => {
    render(<DomainToggle value="both" onChange={() => {}} />);
    expect(screen.getByText('Agent')).toBeTruthy();
    expect(screen.getByText('App')).toBeTruthy();
    expect(screen.getByText('Both')).toBeTruthy();
  });

  it('calls onChange when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DomainToggle value="both" onChange={onChange} />);
    await act(async () => {
      await user.click(screen.getByText('Agent'));
    });
    expect(onChange).toHaveBeenCalledWith('agent');
  });

  it('highlights the selected segment', () => {
    const { container } = render(<DomainToggle value="agent" onChange={() => {}} />);
    const buttons = container.querySelectorAll('button');
    // The first button (Agent) should be selected.
    expect(buttons[0]!.className).toContain('Mui-selected');
  });
});
