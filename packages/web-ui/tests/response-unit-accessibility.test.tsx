// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ResponseUnit } from '../src/chat/response-unit/ResponseUnit';

afterEach(cleanup);

describe('ResponseUnit accessibility', () => {
  it('exposes an article label and keyboard-operable disclosure', async () => {
    const user = userEvent.setup();
    render(
      <ResponseUnit
        document={{
          version: 1,
          title: 'Accessible report',
          blocks: [{
            type: 'collapsible',
            title: 'Evidence',
            blocks: [{ type: 'text', content: 'Hidden evidence' }],
          }],
        }}
      />,
    );

    expect(screen.getByRole('article', { name: 'Accessible report' })).toBeTruthy();
    const disclosure = screen.getByRole('button', { name: 'Evidence' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    disclosure.focus();
    await user.keyboard('{Enter}');
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Hidden evidence')).toBeTruthy();
  });

  it('renders only validated HTTPS actions as links', () => {
    render(
      <ResponseUnit
        document={{
          version: 1,
          blocks: [{
            type: 'link_list',
            links: [{ label: 'Safe documentation', href: 'https://example.com/docs' }],
          }],
        }}
      />,
    );
    const link = screen.getByRole('link', { name: /Safe documentation.*external browser/ });
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
