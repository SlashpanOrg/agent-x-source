import { describe, expect, it } from 'vitest';
import {
  extractNgrokFailureMessage,
  extractNgrokPublicUrl,
  ngrokOutputIndicatesAuthFailure,
  validateNgrokAuthtokenShape,
} from '../src/host/providers/ngrok-agent-logs.js';

describe('ngrok-agent-logs', () => {
  it('extracts public URL from json log lines', () => {
    expect(
      extractNgrokPublicUrl('{"url":"https://abc.ngrok-free.app","msg":"started tunnel"}'),
    ).toBe('https://abc.ngrok-free.app');
  });

  it('detects auth failure and redacts token in message', () => {
    const output = [
      '{"lvl":"eror","err":"authentication failed: The authtoken you specified does not look like a proper ngrok authtoken.\\nYour authtoken: secret_token_value\\nERR_NGROK_105\\r\\n"}',
      'ERROR:  ERR_NGROK_105',
    ].join('\n');
    expect(ngrokOutputIndicatesAuthFailure(output)).toBe(true);
    const msg = extractNgrokFailureMessage(output);
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/authentication failed|ERR_NGROK_105/i);
    expect(msg).not.toContain('secret_token_value');
  });

  it('rejects credential ids and short tokens', () => {
    expect(validateNgrokAuthtokenShape('cr_3HmX6ePwXAdpz8Ryj37VcxPShK6').ok).toBe(false);
    expect(validateNgrokAuthtokenShape('short').ok).toBe(false);
    expect(
      validateNgrokAuthtokenShape('2abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUV').ok,
    ).toBe(true);
  });
});
