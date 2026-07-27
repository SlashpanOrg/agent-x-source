// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { CopyButton } from '../../src/observability/components/CopyButton.js';

const writeTextMock = vi.fn().mockResolvedValue(undefined);

beforeAll(() => {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    writable: true,
    configurable: true,
  });
});

describe('CopyButton', () => {
  it('renders a copy button', () => {
    render(<CopyButton text="test-text" />);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('calls clipboard.writeText on click', async () => {
    writeTextMock.mockClear();
    render(<CopyButton text="hello-world" />);
    const btn = screen.getByRole('button');
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(writeTextMock).toHaveBeenCalledWith('hello-world');
  });
});
