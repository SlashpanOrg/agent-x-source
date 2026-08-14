import { describe, expect, it } from 'vitest';
import { mergeHostConfigPreservingSecrets } from '../src/host/routes.js';
import type { HostConfig } from '@agentx/shared';

function hostWithToken(token: string): HostConfig {
  return {
    tunnelProviders: {
      ngrok: { credentials: { authToken: token } },
    },
  };
}

describe('mergeHostConfigPreservingSecrets', () => {
  it('keeps a newly verified authtoken even when the client still sends authTokenConfigured: false', () => {
    const merged = mergeHostConfigPreservingSecrets(
      { tunnelProviders: {} },
      {
        tunnelProviders: {
          ngrok: {
            credentials: {
              authToken: '2fresh_ngrok_authtoken_value',
              authTokenConfigured: false,
            },
          },
        },
      },
    );
    expect(merged.tunnelProviders?.ngrok?.credentials?.authToken).toBe('2fresh_ngrok_authtoken_value');
  });

  it('preserves the stored authtoken when the client sends only the redacted configured flag', () => {
    const merged = mergeHostConfigPreservingSecrets(hostWithToken('stored-token'), {
      tunnelProviders: {
        ngrok: { credentials: { authTokenConfigured: true } },
      },
    });
    expect(merged.tunnelProviders?.ngrok?.credentials?.authToken).toBe('stored-token');
  });

  it('clears the authtoken only when revoke sends configured=false without a replacement', () => {
    const merged = mergeHostConfigPreservingSecrets(hostWithToken('stored-token'), {
      tunnelProviders: {
        ngrok: { credentials: { authToken: '', authTokenConfigured: false } },
      },
    });
    expect(merged.tunnelProviders?.ngrok?.credentials?.authToken).toBe('');
  });
});
