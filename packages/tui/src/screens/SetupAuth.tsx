import { type FC, useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { COLORS } from '../theme/colors.js';
import { Banner } from '../components/Banner.js';
import { authManager } from '@agentx/shared';

interface SetupAuthProps {
  onComplete: () => void;
}

function getPasswordStrength(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 5);
}

function strengthLabel(score: number): { label: string; color: string } {
  if (score <= 1) return { label: 'Very Weak', color: COLORS.error };
  if (score === 2) return { label: 'Weak', color: '#cc8844' };
  if (score === 3) return { label: 'Fair', color: '#cccc44' };
  if (score === 4) return { label: 'Strong', color: '#44cc88' };
  return { label: 'Very Strong', color: '#44cc44' };
}

export const SetupAuth: FC<SetupAuthProps> = ({ onComplete }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [field, setField] = useState<'username' | 'password' | 'confirm'>('username');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const pwdStrength = getPasswordStrength(password);
  const pwdInfo = strengthLabel(pwdStrength);

  const handleSubmit = useCallback(async () => {
    if (!username.trim() || username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setError('Password must contain uppercase, lowercase, number, and special character');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await authManager.createRootUser(username.trim(), password);
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup failed');
      setSubmitting(false);
    }
  }, [username, password, confirmPassword, onComplete]);

  useInput((_input, key) => {
    if (key.return) {
      if (field === 'username') {
        if (username.trim().length >= 3) setField('password');
      } else if (field === 'password') {
        if (password.length >= 8) setField('confirm');
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
        <Text color={COLORS.primary} bold>Security Setup</Text>
        <Text color={COLORS.textDim}> — Create your root account</Text>
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
              onSubmit={() => username.trim().length >= 3 && setField('password')}
              placeholder="agent"
            />
          </Box>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={field === 'password' ? COLORS.text : COLORS.textDim}>
          Password {field === 'password' ? <Text color={COLORS.primary}>❯</Text> : ' '}
        </Text>
        {field === 'password' && (
          <>
            <Box>
              <Text color={COLORS.primary}>❯ </Text>
              <TextInput
                value={password}
                onChange={setPassword}
                onSubmit={() => password.length >= 8 && setField('confirm')}
                mask="*"
                placeholder="Min 8 chars, A-Z, a-z, 0-9, special"
              />
            </Box>
            {password.length > 0 && (
              <Box marginTop={1}>
                <Text color={pwdInfo.color}>Strength: {pwdInfo.label}</Text>
                <Text color={COLORS.textDim}> {'█'.repeat(pwdStrength)}{'░'.repeat(5 - pwdStrength)}</Text>
              </Box>
            )}
          </>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={field === 'confirm' ? COLORS.text : COLORS.textDim}>
          Confirm Password {field === 'confirm' ? <Text color={COLORS.primary}>❯</Text> : ' '}
        </Text>
        {field === 'confirm' && (
          <Box>
            <Text color={COLORS.primary}>❯ </Text>
            <TextInput
              value={confirmPassword}
              onChange={setConfirmPassword}
              onSubmit={() => void handleSubmit()}
              mask="*"
              placeholder="Re-enter password"
            />
          </Box>
        )}
      </Box>

      <Box marginTop={2}>
        <Text color={COLORS.textDim} dimColor>
          {submitting ? 'Creating account...' : 'Enter to continue • Esc to exit'}
        </Text>
      </Box>
    </Box>
  );
};
