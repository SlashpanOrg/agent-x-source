import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Collapse from '@mui/material/Collapse';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import type {
  HostConfig,
  TelephonyAiDisclosure,
  TelephonyRecordingPolicy,
  TelephonyDefaultInboundMissionDraft,
} from '@agentx/shared/browser';
import { defaultHostConfig, mergeHostConfig } from '@agentx/shared/browser';
import {
  telephonyApi,
  type TelephonyProviderCatalogEntry,
  type TelephonyNumberBinding,
  type TelephonyWebhookTestResult,
} from '../../api';
import {
  settingsTheme,
  settingsMonoSx,
  settingsHelperSx,
  settingsTextFieldSx,
  settingsOverlineSx,
  settingsBtnGhostSx,
  settingsBtnPrimarySx,
  settingsStatusBadgeSx,
  settingsCardSx,
} from '../../styles/settings-theme';
import { alphaColor } from '../../theme';

export interface VoipChannelsPanelProps {
  hostConfig: HostConfig;
  onHostChange: (next: HostConfig) => void;
}

export function VoipChannelsPanel({ hostConfig, onHostChange }: VoipChannelsPanelProps) {
  const cfg = useMemo(() => mergeHostConfig(defaultHostConfig(), hostConfig), [hostConfig]);
  const telephony = cfg.telephony ?? {};
  const activeId = telephony.activeProviderId ?? null;

  const [catalog, setCatalog] = useState<TelephonyProviderCatalogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [draftSecrets, setDraftSecrets] = useState<Record<string, Record<string, string>>>({});
  const [numbers, setNumbers] = useState<TelephonyNumberBinding[]>([]);

  const refreshCatalog = useCallback(async () => {
    try {
      const t = await telephonyApi.providers();
      setCatalog(t.providers ?? []);
    } catch {
      /* catalog may 503 before gateway init */
    }
  }, []);

  useEffect(() => {
    void refreshCatalog();
    const id = setInterval(() => void refreshCatalog(), 8000);
    return () => clearInterval(id);
  }, [refreshCatalog]);

  const patch = (next: Partial<HostConfig>) => {
    onHostChange(mergeHostConfig(cfg, next));
  };

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const loadNumbers = useCallback(async () => {
    if (!activeId) {
      setNumbers([]);
      return;
    }
    try {
      const res = await telephonyApi.listNumbers(activeId);
      setNumbers(res.numbers);
    } catch {
      setNumbers([]);
    }
  }, [activeId]);

  useEffect(() => {
    void loadNumbers();
  }, [loadNumbers]);

  return (
    <Box>
      {flash && (
        <Alert severity="error" sx={{ mb: 2, bgcolor: alphaColor(settingsTheme.accent.alert, 0.08) }}>
          {flash}
        </Alert>
      )}

      <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
        Pick a phone provider, paste credentials, bind a number. Configuration only — no dialer in this UI.
      </Typography>

      {catalog.map((entry) => {
        const selected = activeId === entry.id;
        const ready = entry.adapterRegistered !== false;
        const creds = telephony.providers?.[entry.id]?.credentials ?? {};
        const drafts = draftSecrets[`voip:${entry.id}`] ?? {};
        return (
          <Box key={entry.id} sx={settingsCardSx(entry.accent, selected)}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: '0.85rem' }}>{entry.name}</Typography>
                <Typography sx={settingsHelperSx}>{entry.tagline}</Typography>
                {!ready && (
                  <Typography sx={{ ...settingsHelperSx, color: settingsTheme.accent.amber }}>
                    Adapter coming soon — catalog reserved for plug-in
                  </Typography>
                )}
              </Box>
              <Switch
                checked={selected}
                disabled={!ready}
                onChange={(_, checked) =>
                  patch({
                    telephony: {
                      ...telephony,
                      activeProviderId: checked ? entry.id : null,
                      ...(checked
                        ? { inboundEnabled: true, outboundEnabled: true, maxConcurrentCalls: 1 }
                        : {}),
                    },
                  })
                }
              />
            </Box>
            <Collapse in={selected && ready}>
              <Box sx={{ mt: 1.5 }}>
                {entry.setupSteps.map((step) => (
                  <Typography key={step} sx={{ ...settingsHelperSx, display: 'block', mb: 0.35 }}>
                    · {step}
                  </Typography>
                ))}
                {entry.credentialFields.map((field) => {
                  const configuredFlag =
                    field.key === 'authToken'
                      ? creds.authTokenConfigured
                      : field.key === 'apiKey'
                        ? creds.apiKeyConfigured
                        : field.key === 'apiSecret'
                          ? creds.apiSecretConfigured
                          : false;
                  return (
                    <TextField
                      key={field.key}
                      size="small"
                      fullWidth
                      label={field.label}
                      type={field.secret ? 'password' : 'text'}
                      placeholder={
                        field.secret && configuredFlag
                          ? '•••• stored — paste to replace'
                          : field.placeholder
                      }
                      helperText={field.helperText}
                      value={
                        field.secret
                          ? drafts[field.key] ?? ''
                          : drafts[field.key] ?? (creds as Record<string, string | undefined>)[field.key] ?? ''
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setDraftSecrets((prev) => ({
                          ...prev,
                          [`voip:${entry.id}`]: { ...prev[`voip:${entry.id}`], [field.key]: v },
                        }));
                        if (!field.secret || v.trim()) {
                          patch({
                            telephony: {
                              ...telephony,
                              providers: {
                                ...telephony.providers,
                                [entry.id]: {
                                  ...telephony.providers?.[entry.id],
                                  credentials: {
                                    ...telephony.providers?.[entry.id]?.credentials,
                                    [field.key]: v,
                                  },
                                },
                              },
                            },
                          });
                        }
                      }}
                      sx={{ ...settingsTextFieldSx, mt: 1 }}
                    />
                  );
                })}
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                  <Button
                    size="small"
                    sx={settingsBtnGhostSx}
                    disabled={busy === `test-voip-${entry.id}`}
                    onClick={() =>
                      void run(`test-voip-${entry.id}`, () =>
                        telephonyApi.testCredentials(entry.id, drafts),
                      )
                    }
                  >
                    {busy === `test-voip-${entry.id}` ? <CircularProgress size={14} /> : 'Test connection'}
                  </Button>
                </Box>
                <CapabilityChips capabilities={entry.capabilities} />
              </Box>
            </Collapse>
          </Box>
        );
      })}

      {activeId && (
        <NumberBindingSection
          providerId={activeId}
          numbers={numbers}
          onBound={loadNumbers}
          run={run}
          busy={busy}
        />
      )}

      {activeId && (
        <DefaultInboundMissionSection
          cfg={cfg}
          providerId={activeId}
          numbers={numbers}
          patch={patch}
          run={run}
          busy={busy}
        />
      )}
    </Box>
  );
}

function NumberBindingSection(props: {
  providerId: string;
  numbers: TelephonyNumberBinding[];
  onBound: () => Promise<void>;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  busy: string | null;
}) {
  const { providerId, numbers, onBound, run, busy } = props;
  const [draft, setDraft] = useState({ e164: '', label: '', inboundEnabled: true, outboundEnabled: false });
  const [webhookInfo, setWebhookInfo] = useState<TelephonyWebhookTestResult | null>(null);

  const bindKey = `bind-number-${providerId}`;
  const webhookKey = `webhook-test-${providerId}`;

  const bindNumber = () =>
    run(bindKey, async () => {
      await telephonyApi.verifyNumber(providerId, {
        e164: draft.e164.trim(),
        label: draft.label.trim() || undefined,
        inboundEnabled: draft.inboundEnabled,
        outboundEnabled: draft.outboundEnabled,
      });
      setDraft({ e164: '', label: '', inboundEnabled: true, outboundEnabled: false });
      await onBound();
    });

  const testWebhook = () =>
    run(webhookKey, async () => {
      const res = await telephonyApi.testWebhook(providerId);
      setWebhookInfo(res);
    });

  return (
    <Box sx={{ ...settingsCardSx(), mt: 2 }}>
      <Typography sx={settingsOverlineSx}>Phone numbers</Typography>
      <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
        Bind a verified E.164 number for inbound/outbound routing — no dialer, binding only.
      </Typography>

      {numbers.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          {numbers.map((n) => (
            <Box
              key={n.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                py: 0.75,
                borderTop: `1px solid ${settingsTheme.border.subtle}`,
              }}
            >
              <Box>
                <Typography sx={{ ...settingsMonoSx, fontSize: '0.75rem', color: settingsTheme.text.primary }}>
                  {n.label || n.e164Redacted || n.providerNumberId || n.id}
                </Typography>
                <Typography sx={settingsHelperSx}>{n.e164Redacted ?? '—'}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Box sx={{ ...settingsStatusBadgeSx(n.inboundEnabled ? 'active' : 'idle'), opacity: n.inboundEnabled ? 1 : 0.45 }}>
                  In
                </Box>
                <Box sx={{ ...settingsStatusBadgeSx(n.outboundEnabled ? 'active' : 'idle'), opacity: n.outboundEnabled ? 1 : 0.45 }}>
                  Out
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      <TextField
        size="small"
        fullWidth
        label="E.164 number"
        placeholder="+15551234567"
        value={draft.e164}
        onChange={(e) => setDraft((d) => ({ ...d, e164: e.target.value }))}
        sx={{ ...settingsTextFieldSx, mb: 1 }}
      />
      <TextField
        size="small"
        fullWidth
        label="Label"
        placeholder="Main support line"
        value={draft.label}
        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
        sx={{ ...settingsTextFieldSx, mb: 1 }}
      />
      <Box sx={{ display: 'flex', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={draft.inboundEnabled}
              onChange={(_, c) => setDraft((d) => ({ ...d, inboundEnabled: c }))}
              inputProps={{ 'aria-label': 'Enable inbound for this number' }}
            />
          }
          label={<Typography sx={{ fontSize: '0.7rem', ...settingsMonoSx }}>Inbound</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={draft.outboundEnabled}
              onChange={(_, c) => setDraft((d) => ({ ...d, outboundEnabled: c }))}
              inputProps={{ 'aria-label': 'Enable outbound for this number' }}
            />
          }
          label={<Typography sx={{ fontSize: '0.7rem', ...settingsMonoSx }}>Outbound</Typography>}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          sx={settingsBtnPrimarySx}
          disabled={busy === bindKey || !draft.e164.trim()}
          onClick={() => void bindNumber()}
        >
          {busy === bindKey ? <CircularProgress size={14} /> : 'Verify & bind number'}
        </Button>
        <Button
          size="small"
          sx={settingsBtnGhostSx}
          disabled={busy === webhookKey}
          aria-label="Test webhook endpoints"
          onClick={() => void testWebhook()}
        >
          {busy === webhookKey ? <CircularProgress size={14} /> : 'Test webhook'}
        </Button>
      </Box>
      {webhookInfo && (
        <Box sx={{ mt: 1.5 }}>
          <Typography sx={settingsHelperSx}>Inbound path · {webhookInfo.inboundPath}</Typography>
          <Typography sx={settingsHelperSx}>Status path · {webhookInfo.statusPath}</Typography>
          <Typography sx={settingsHelperSx}>Media path · {webhookInfo.mediaPath}</Typography>
          <Typography sx={settingsHelperSx}>
            Signature verification · {webhookInfo.signatureRequired ? 'required' : 'not required'}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function DefaultInboundMissionSection(props: {
  cfg: HostConfig;
  providerId: string;
  numbers: TelephonyNumberBinding[];
  patch: (next: Partial<HostConfig>) => void;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  busy: string | null;
}) {
  const { cfg, providerId, numbers, patch, run, busy } = props;
  const telephony = cfg.telephony ?? {};
  const draft: TelephonyDefaultInboundMissionDraft = telephony.defaultInboundMission ?? {};

  const updateDraft = (next: Partial<TelephonyDefaultInboundMissionDraft>) => {
    patch({ telephony: { ...telephony, defaultInboundMission: { ...draft, ...next } } });
  };

  const armKey = `arm-inbound-mission-${providerId}`;

  const saveAndArm = () =>
    run(armKey, async () => {
      const inboundNumber = numbers.find((n) => n.inboundEnabled) ?? numbers[0];
      const mission = await telephonyApi.createMission({
        direction: 'inbound',
        providerId,
        phoneNumberId: inboundNumber?.id ?? 'default',
        purpose:
          draft.purpose?.trim() ||
          'Answer the call, clearly identify as an AI assistant, take a message, and offer human transfer.',
        maxDurationSeconds: draft.maxDurationSeconds ?? 600,
        recording: draft.recording ?? 'off',
        aiDisclosure: draft.aiDisclosure ?? 'required',
        escalation: draft.transferNumber?.trim()
          ? { transferNumber: draft.transferNumber.trim(), onLowConfidence: 'ask_repeat' }
          : { onLowConfidence: 'ask_repeat' },
        status: 'armed',
      });
      patch({ telephony: { ...telephony, defaultMissionId: mission.id ?? null } });
    });

  return (
    <Box sx={{ ...settingsCardSx(), mt: 2 }}>
      <Typography sx={settingsOverlineSx}>Default inbound mission</Typography>
      <Typography sx={{ ...settingsHelperSx, mb: 1.5 }}>
        Safe-by-default script used when an inbound call arrives with no dedicated mission.
      </Typography>
      <TextField
        multiline
        minRows={2}
        fullWidth
        size="small"
        label="Purpose"
        placeholder="Answer the call, identify as an AI assistant, take a message…"
        value={draft.purpose ?? ''}
        onChange={(e) => updateDraft({ purpose: e.target.value })}
        sx={{ ...settingsTextFieldSx, mb: 1.5 }}
      />
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
        <TextField
          size="small"
          type="number"
          label="Max duration (sec)"
          value={draft.maxDurationSeconds ?? 600}
          onChange={(e) => updateDraft({ maxDurationSeconds: Number(e.target.value) || 600 })}
          sx={{ ...settingsTextFieldSx, width: 170 }}
        />
        <TextField
          size="small"
          select
          label="Recording"
          value={draft.recording ?? 'off'}
          onChange={(e) => updateDraft({ recording: e.target.value as TelephonyRecordingPolicy })}
          sx={{ ...settingsTextFieldSx, width: 190 }}
        >
          <MenuItem value="off">Off</MenuItem>
          <MenuItem value="on_with_disclosure">On (with disclosure)</MenuItem>
          <MenuItem value="provider_default">Provider default</MenuItem>
        </TextField>
        <TextField
          size="small"
          select
          label="AI disclosure"
          value={draft.aiDisclosure ?? 'required'}
          onChange={(e) => updateDraft({ aiDisclosure: e.target.value as TelephonyAiDisclosure })}
          sx={{ ...settingsTextFieldSx, width: 190 }}
        >
          <MenuItem value="required">Required</MenuItem>
          <MenuItem value="automatic">Automatic</MenuItem>
          <MenuItem value="disabled_only_if_legal">Disabled (where legal)</MenuItem>
        </TextField>
      </Box>
      <TextField
        size="small"
        fullWidth
        label="Human transfer number (E.164)"
        placeholder="+15559876543"
        value={draft.transferNumber ?? ''}
        onChange={(e) => updateDraft({ transferNumber: e.target.value })}
        sx={{ ...settingsTextFieldSx, mb: 1.5 }}
      />
      <Button
        size="small"
        sx={settingsBtnPrimarySx}
        disabled={busy === armKey || !draft.purpose?.trim()}
        onClick={() => void saveAndArm()}
      >
        {busy === armKey ? <CircularProgress size={14} /> : 'Save & arm mission'}
      </Button>
      {telephony.defaultMissionId && (
        <Typography sx={{ ...settingsHelperSx, mt: 1, color: settingsTheme.accent.signal }}>
          Armed mission id · {telephony.defaultMissionId}
        </Typography>
      )}
    </Box>
  );
}

function CapabilityChips({ capabilities }: { capabilities: Record<string, unknown> }) {
  const flags = [
    ['inboundCalls', 'Inbound'],
    ['outboundCalls', 'Outbound'],
    ['bidirectionalMediaStreams', 'Media stream'],
    ['recording', 'Recording'],
    ['sms', 'SMS'],
    ['webhookSignatureVerification', 'Signed webhooks'],
  ] as const;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1.5 }}>
      {flags.map(([key, label]) => {
        const on = Boolean(capabilities[key]);
        return (
          <Box
            key={key}
            sx={{
              ...settingsStatusBadgeSx(on ? 'active' : 'idle'),
              opacity: on ? 1 : 0.45,
            }}
          >
            {label}
          </Box>
        );
      })}
    </Box>
  );
}
