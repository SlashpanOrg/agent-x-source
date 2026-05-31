import { type FC, useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { Banner } from '../components/Banner.js';
import { authManager } from '@agentx/shared';

interface LoginProps {
  onLogin: (token: string) => void;
}

export const Login: FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [field, setField] = useState<'username' | 'password'>('username');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!username.trim() || !password) {
      setError('Username and password are required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await authManager.login(username.trim(), password);
      onLogin(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authentication failed');
      setSubmitting(false);
    }
  }, [username, password, onLogin]);

  useInput((_input, key) => {
    if (key.return) {
      if (field === 'username') {
        if (username.trim()) setField('password');
      } else {
        void handleSubmit();
      }
    }
    if (key.escape) {
      process.exit(0);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Banner />
      <Box marginTop={1} marginBottom={1}>
        <Text color={COLORS.primary} bold>Authentication Required</Text>
        <Text color={COLORS.textDim}> — Sign in to continue</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color={COLORS.error}>⚠ {error}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text color={field === 'username' ? COLORS.text : COLORS.textDim}>
          Username {field === 'username' ? <Text color={COLORS.primary}>❯</Text> : ' '}
        </Text>
        {field === 'username' && (
          <Box>
            <Text color={COLORS.primary}>❯ </Text>
            <TextInput
              value={username}
              onChange={setUsername}
              onSubmit={() => username.trim() && setField('password')}
              placeholder="your-username"
            />
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={field === 'password' ? COLORS.text : COLORS.textDim}>
          Password {field === 'password' ? <Text color={COLORS.primary}>❯</Text> : ' '}
        </Text>
        {field === 'password' && (
          <Box>
            <Text color={COLORS.primary}>❯ </Text>
            <TextInput
              value={password}
              onChange={setPassword}
              onSubmit={() => void handleSubmit()}
              mask="*"
              placeholder="••••••••"
            />
          </Box>
        )}
      </Box>

      <Box marginTop={2}>
        <Text color={COLORS.textDim} dimColor>
          {submitting ? 'Signing in...' : 'Enter to sign in • Esc to exit'}
        </Text>
      </Box>
    </Box>
  );
};
