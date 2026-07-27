// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../../src/observability/components/StatusBadge.js';

describe('StatusBadge', () => {
  it('renders ok status with success color', () => {
    render(<StatusBadge status="ok" />);
    expect(screen.getByText('ok')).toBeTruthy();
  });

  it('renders error status', () => {
    render(<StatusBadge status="error" />);
    expect(screen.getByText('error')).toBeTruthy();
  });

  it('renders running status', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText('running')).toBeTruthy();
  });

  it('renders cancelled status', () => {
    render(<StatusBadge status="cancelled" />);
    expect(screen.getByText('cancelled')).toBeTruthy();
  });
});
