/**
 * Multi-step wizard for *new custom* crew recruitment only.
 * Hub imports and "Modify Personnel" edit dialogs stay elsewhere.
 */
import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { crewTheme } from '../../styles/crew-theme';
import { alphaColor } from '../../theme';
import {
  CREW_PERSONA_TEMPLATES,
  buildCrewPersonaFromTemplate,
  getCrewPersonaTemplate,
  type CrewPersonaTemplateId,
} from './crew-persona-templates';

const EMOTIONS = ['professional', 'friendly', 'witty', 'kind', 'funny', 'sarcastic', 'arrogant', 'flirty', 'happy', 'sad'] as const;

const SYSTEM_PROMPT_PLACEHOLDER = `You are a [role] specializing in [domain].

Your expertise:
- [skill 1]
- [skill 2]

Communication style: [concise/verbose/technical/casual]
Always respond with practical, actionable advice.`;

export interface CrewCreateFormState {
  name: string;
  title: string;
  callsign: string;
  description: string;
  systemPrompt: string;
  tone: string;
  expertise: string[];
  traits: string[];
}

export interface CrewCreateWizardDialogProps {
  open: boolean;
  busy: boolean;
  generatingMeta: boolean;
  error: string;
  onClose: () => void;
  onSave: (form: CrewCreateFormState) => void | Promise<void>;
  onGenerateMetadata: (form: CrewCreateFormState) => Promise<CrewCreateFormState | null>;
}

type WizardStep = 'template' | 'domain' | 'details';

function toCallsign(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

const EMPTY: CrewCreateFormState = {
  name: '',
  title: '',
  callsign: '',
  description: '',
  systemPrompt: '',
  tone: 'professional',
  expertise: [],
  traits: [],
};

export function CrewCreateWizardDialog({
  open,
  busy,
  generatingMeta,
  error,
  onClose,
  onSave,
  onGenerateMetadata,
}: CrewCreateWizardDialogProps) {
  const [step, setStep] = useState<WizardStep>('template');
  const [templateId, setTemplateId] = useState<CrewPersonaTemplateId | null>(null);
  const [domain, setDomain] = useState('');
  const [form, setForm] = useState<CrewCreateFormState>(EMPTY);
  const [expertiseInput, setExpertiseInput] = useState('');
  const [traitInput, setTraitInput] = useState('');
  const [localError, setLocalError] = useState('');

  const template = getCrewPersonaTemplate(templateId);
  const isCustom = templateId === 'custom';
  const personaLocked = Boolean(templateId && templateId !== 'custom');

  const stepLabel = useMemo(() => {
    if (step === 'template') return 'Step 1 · Behaviour profile';
    if (step === 'domain') return 'Step 2 · Domain';
    return 'Step 3 · Identity';
  }, [step]);

  const reset = () => {
    setStep('template');
    setTemplateId(null);
    setDomain('');
    setForm(EMPTY);
    setExpertiseInput('');
    setTraitInput('');
    setLocalError('');
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleNameChange = (name: string) => {
    setForm((prev) => ({
      ...prev,
      name,
      callsign: prev.callsign.trim() ? prev.callsign : toCallsign(name),
    }));
  };

  const applyTemplateBuild = (next: { name: string; title: string; callsign: string; domain: string }) => {
    if (!template || template.id === 'custom') return;
    const built = buildCrewPersonaFromTemplate(template, next);
    setForm((prev) => ({
      ...prev,
      ...next,
      description: built.description,
      tone: built.tone,
      expertise: built.expertise,
      traits: built.traits,
      systemPrompt: built.systemPrompt,
    }));
  };

  const goDomain = () => {
    if (!templateId) {
      setLocalError('Pick a behaviour profile to continue.');
      return;
    }
    setLocalError('');
    setStep('domain');
  };

  const goDetails = () => {
    if (!domain.trim()) {
      setLocalError('Tell us which domain this crew works in.');
      return;
    }
    setLocalError('');
    setStep('details');
    if (template && template.id !== 'custom') {
      applyTemplateBuild({
        name: form.name,
        title: form.title || template.label,
        callsign: form.callsign,
        domain: domain.trim(),
      });
    }
  };

  const syncLockedPersona = (patch: Partial<CrewCreateFormState>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (personaLocked && template) {
      const built = buildCrewPersonaFromTemplate(template, {
        name: next.name,
        title: next.title || template.label,
        callsign: next.callsign,
        domain: domain.trim(),
      });
      setForm({
        ...next,
        description: built.description,
        tone: built.tone,
        expertise: built.expertise,
        traits: built.traits,
        systemPrompt: built.systemPrompt,
      });
    }
  };

  const handleDeploy = async () => {
    if (!form.name.trim()) {
      setLocalError('Name is required');
      return;
    }
    if (isCustom && !form.systemPrompt.trim()) {
      setLocalError('System prompt is required for Custom crews');
      return;
    }
    try {
      if (personaLocked && template) {
        const built = buildCrewPersonaFromTemplate(template, {
          name: form.name.trim(),
          title: form.title.trim() || template.label,
          callsign: form.callsign.trim() || toCallsign(form.name),
          domain: domain.trim(),
        });
        await onSave({
          ...form,
          name: form.name.trim(),
          title: form.title.trim() || template.label,
          callsign: form.callsign.trim() || toCallsign(form.name),
          description: built.description,
          tone: built.tone,
          expertise: built.expertise,
          traits: built.traits,
          systemPrompt: built.systemPrompt,
        });
      } else {
        await onSave({
          ...form,
          name: form.name.trim(),
          title: form.title.trim(),
          callsign: form.callsign.trim() || toCallsign(form.name),
        });
      }
      reset();
    } catch {
      // Parent sets error; keep wizard open.
    }
  };

  const handleAutoGenerate = async () => {
    const updated = await onGenerateMetadata(form);
    if (updated) setForm(updated);
  };

  const displayError = localError || error;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      PaperProps={{
        sx: {
          bgcolor: crewTheme.bg.panel,
          border: `1px solid ${crewTheme.border.default}`,
          borderRadius: '8px',
          maxWidth: step === 'template' ? 640 : 580,
          width: '100%',
        },
      }}
    >
      <DialogTitle sx={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: '0.48rem',
        letterSpacing: '2px', textTransform: 'uppercase', color: crewTheme.text.dim, pb: 0, pt: 2,
      }}>
        New Recruitment · {stepLabel}
      </DialogTitle>
      <DialogTitle sx={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: '0.82rem',
        fontWeight: 700, letterSpacing: '1px', pt: 0.5, color: crewTheme.text.primary,
      }}>
        CREATE CREW
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {displayError ? (
          <Typography sx={{ fontSize: '0.7rem', color: '#e57373' }}>{displayError}</Typography>
        ) : null}

        {step === 'template' && (
          <>
            <Typography sx={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.58rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: crewTheme.text.dim,
              mb: 0.25,
            }}
            >
              Select behaviour profile · custom recruits only
            </Typography>
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
              gap: '6px',
            }}
            >
              {CREW_PERSONA_TEMPLATES.map((t) => {
                const selected = templateId === t.id;
                return (
                  <Box
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setTemplateId(t.id); setLocalError(''); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setTemplateId(t.id);
                        setLocalError('');
                      }
                    }}
                    sx={{
                      position: 'relative',
                      px: 1,
                      py: 0.85,
                      minHeight: 64,
                      borderRadius: '4px',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      border: `1px solid ${selected ? t.accent : crewTheme.border.default}`,
                      bgcolor: selected
                        ? alphaColor(t.accent, 0.1)
                        : alphaColor(crewTheme.bg.void, 0.55),
                      boxShadow: selected
                        ? `inset 3px 0 0 ${t.accent}, 0 0 0 1px ${alphaColor(t.accent, 0.25)}`
                        : 'inset 3px 0 0 transparent',
                      transition: 'border-color 0.12s, background-color 0.12s, box-shadow 0.12s, transform 0.12s',
                      '&:hover': {
                        borderColor: t.accent,
                        bgcolor: alphaColor(t.accent, 0.07),
                        transform: 'translateY(-1px)',
                        boxShadow: `inset 3px 0 0 ${t.accent}, 0 6px 18px ${alphaColor(t.accent, 0.12)}`,
                      },
                      // Corner ticks
                      '&::before, &::after': {
                        content: '""',
                        position: 'absolute',
                        width: 6,
                        height: 6,
                        borderColor: selected ? t.accent : crewTheme.border.strong,
                        borderStyle: 'solid',
                        opacity: selected ? 1 : 0.45,
                        transition: 'opacity 0.12s, border-color 0.12s',
                      },
                      '&::before': {
                        top: 3,
                        left: 3,
                        borderWidth: '1px 0 0 1px',
                      },
                      '&::after': {
                        bottom: 3,
                        right: 3,
                        borderWidth: '0 1px 1px 0',
                      },
                      '&:hover::before, &:hover::after': {
                        opacity: 1,
                        borderColor: t.accent,
                      },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5, mb: 0.35 }}>
                      <Typography sx={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        letterSpacing: '0.02em',
                        color: crewTheme.text.primary,
                        lineHeight: 1.15,
                      }}
                      >
                        {t.label}
                      </Typography>
                      <Box sx={{
                        flexShrink: 0,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: '0.48rem',
                        fontWeight: 700,
                        letterSpacing: '0.14em',
                        color: selected ? t.accent : crewTheme.text.dim,
                        border: `1px solid ${selected ? alphaColor(t.accent, 0.55) : crewTheme.border.default}`,
                        bgcolor: selected ? alphaColor(t.accent, 0.12) : 'transparent',
                        px: 0.45,
                        py: '1px',
                        borderRadius: '2px',
                      }}
                      >
                        {t.badge}
                      </Box>
                    </Box>
                    <Typography sx={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.52rem',
                      letterSpacing: '0.04em',
                      color: selected ? alphaColor(t.accent, 0.95) : crewTheme.text.dim,
                      lineHeight: 1.35,
                    }}
                    >
                      {t.blurb}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </>
        )}

        {step === 'domain' && template && (
          <>
            <Typography sx={{ fontSize: '0.72rem', color: crewTheme.text.secondary, lineHeight: 1.5 }}>
              Which domain should{' '}
              <Box component="span" sx={{ color: crewTheme.text.primary, fontWeight: 600 }}>{template.label}</Box>
              {' '}work in? This shapes the persona and system prompt.
            </Typography>
            <TextField
              size="small"
              label="Domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              fullWidth
              placeholder="e.g. B2B SaaS support, software engineering interviews…"
              autoFocus
            />
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {template.suggestedDomains.map((d) => (
                <Chip
                  key={d}
                  size="small"
                  label={d}
                  onClick={() => setDomain(d)}
                  sx={{
                    fontSize: '0.6rem',
                    cursor: 'pointer',
                    bgcolor: domain === d ? alphaColor(crewTheme.accent.hud, '25') : 'transparent',
                    border: `1px solid ${domain === d ? crewTheme.accent.hud : crewTheme.border.default}`,
                    color: domain === d ? crewTheme.accent.hud : crewTheme.text.secondary,
                  }}
                />
              ))}
            </Box>
          </>
        )}

        {step === 'details' && template && (
          <>
            <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.dim, letterSpacing: '0.5px' }}>
              Profile · {template.label} · {domain.trim()}
            </Typography>

            <Box>
              <TextField size="small" label="Name" value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  if (personaLocked) syncLockedPersona({ name, callsign: form.callsign.trim() ? form.callsign : toCallsign(name) });
                  else handleNameChange(name);
                }}
                fullWidth placeholder="e.g. Raj Patel" autoFocus />
              <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mt: 0.5 }}>
                The crew member's full name. This is a person, not a job title.
              </Typography>
            </Box>

            <Box>
              <TextField size="small" label="Title" value={form.title}
                onChange={(e) => {
                  const title = e.target.value;
                  if (personaLocked) syncLockedPersona({ title });
                  else setForm({ ...form, title });
                }}
                fullWidth placeholder={personaLocked ? `e.g. ${template.label} · ${domain.trim()}` : 'e.g. Backend Architect'} />
              <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mt: 0.5 }}>
                Their role. Shown as "Name - Title" in @mentions.
              </Typography>
            </Box>

            <Box>
              <TextField size="small" label="Callsign" value={form.callsign}
                onChange={(e) => {
                  const callsign = e.target.value.replace(/\s/g, '').toLowerCase();
                  if (personaLocked) syncLockedPersona({ callsign });
                  else setForm({ ...form, callsign });
                }}
                fullWidth placeholder="e.g. support_maya" />
              <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mt: 0.5 }}>
                Unique handle for @mentions — no spaces.
              </Typography>
            </Box>

            {personaLocked ? (
              <Box sx={{
                border: `1px solid ${crewTheme.border.subtle}`,
                borderRadius: '8px',
                p: 1.5,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
                bgcolor: alphaColor(crewTheme.bg.void, 0.35),
              }}
              >
                <Typography sx={{
                  fontSize: '0.55rem', fontWeight: 700, letterSpacing: '1px',
                  textTransform: 'uppercase', color: crewTheme.text.dim,
                }}
                >
                  Persona locked from template
                </Typography>
                <Box>
                  <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mb: 0.35 }}>Description</Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: crewTheme.text.secondary, lineHeight: 1.45 }}>
                    {form.description || '—'}
                  </Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mb: 0.35 }}>Tone</Typography>
                  <Chip size="small" label={form.tone} sx={{ fontSize: '0.6rem', height: 22 }} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mb: 0.5 }}>Skills & expertise</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {form.expertise.map((exp) => (
                      <Chip key={exp} size="small" label={exp}
                        sx={{ height: 20, fontSize: '0.55rem', bgcolor: alphaColor(crewTheme.accent.hud, '15'), color: crewTheme.accent.hud }} />
                    ))}
                  </Box>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mb: 0.5 }}>Traits</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {form.traits.map((t) => (
                      <Chip key={t} size="small" label={t}
                        sx={{ height: 20, fontSize: '0.55rem', bgcolor: alphaColor(crewTheme.accent.purple, '10'), color: crewTheme.accent.purple }} />
                    ))}
                  </Box>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim, mb: 0.35 }}>System prompt</Typography>
                  <Box sx={{
                    maxHeight: 160,
                    overflow: 'auto',
                    p: 1,
                    borderRadius: '6px',
                    border: `1px solid ${crewTheme.border.subtle}`,
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.62rem',
                    lineHeight: 1.55,
                    color: crewTheme.text.secondary,
                    whiteSpace: 'pre-wrap',
                  }}
                  >
                    {form.systemPrompt}
                  </Box>
                </Box>
              </Box>
            ) : (
              <>
                <Box>
                  <TextField size="small" label="Description" value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    fullWidth multiline rows={2}
                    placeholder="A short description of this crew member's character and purpose"
                    slotProps={{ input: { sx: { fontSize: '0.75rem', lineHeight: 1.5 } } }} />
                </Box>

                <Box>
                  <Typography sx={{ fontSize: '0.65rem', color: crewTheme.text.dim, mb: 1, textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Tone / Emotion
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {EMOTIONS.map((t) => (
                      <Chip key={t} size="small" label={t} onClick={() => setForm({ ...form, tone: t })}
                        sx={{
                          fontSize: '0.6rem', cursor: 'pointer',
                          bgcolor: form.tone === t ? alphaColor(crewTheme.accent.purple, '30') : 'transparent',
                          border: `1px solid ${form.tone === t ? crewTheme.accent.purple : crewTheme.border.default}`,
                          color: form.tone === t ? crewTheme.accent.purple : crewTheme.text.secondary,
                        }} />
                    ))}
                  </Box>
                </Box>

                <Box>
                  <TextField size="small" label="System Prompt" value={form.systemPrompt}
                    onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
                    fullWidth multiline rows={8} placeholder={SYSTEM_PROMPT_PLACEHOLDER}
                    sx={{ '& .MuiInputBase-root': { fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', lineHeight: 1.6 } }} />
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 0.5 }}>
                    <Typography sx={{ fontSize: '0.55rem', color: crewTheme.text.dim }}>
                      Defines personality and behavior.
                    </Typography>
                    <Button size="small" onClick={() => void handleAutoGenerate()}
                      disabled={generatingMeta || (!form.name.trim() || !form.title.trim())}
                      startIcon={generatingMeta ? <CircularProgress size={12} /> : <AutoAwesomeIcon sx={{ fontSize: 13 }} />}
                      sx={{ fontSize: '0.55rem', textTransform: 'none', color: crewTheme.accent.purple, minWidth: 'auto' }}>
                      {generatingMeta ? 'Analyzing...' : 'Auto-generate'}
                    </Button>
                  </Box>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: crewTheme.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Skills & Expertise
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                    {form.expertise.map((exp) => (
                      <Chip key={exp} size="small" label={exp}
                        onDelete={() => setForm({ ...form, expertise: form.expertise.filter((e) => e !== exp) })}
                        sx={{ height: 20, fontSize: '0.55rem', bgcolor: alphaColor(crewTheme.accent.hud, '15'), color: crewTheme.accent.hud }} />
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <TextField size="small" placeholder="Add skill..." value={expertiseInput}
                      onChange={(e) => setExpertiseInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && expertiseInput.trim()) {
                          e.preventDefault();
                          setForm({ ...form, expertise: [...form.expertise, expertiseInput.trim()] });
                          setExpertiseInput('');
                        }
                      }}
                      sx={{ flex: 1, '& .MuiInputBase-root': { height: 28, fontSize: '0.65rem' } }} />
                    <Button size="small" variant="outlined" disabled={!expertiseInput.trim()}
                      onClick={() => { setForm({ ...form, expertise: [...form.expertise, expertiseInput.trim()] }); setExpertiseInput(''); }}
                      sx={{ minWidth: 'auto', px: 1, fontSize: '0.6rem', textTransform: 'none', height: 28,
                        borderColor: alphaColor(crewTheme.accent.hud, '50'), color: crewTheme.accent.hud }}>
                      Add
                    </Button>
                  </Box>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 600, color: crewTheme.text.dim, mb: 0.75, textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Traits
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
                    {form.traits.map((t) => (
                      <Chip key={t} size="small" label={t}
                        onDelete={() => setForm({ ...form, traits: form.traits.filter((tr) => tr !== t) })}
                        sx={{ height: 20, fontSize: '0.55rem', bgcolor: alphaColor(crewTheme.accent.purple, '10'), color: crewTheme.accent.purple }} />
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <TextField size="small" placeholder="Add trait..." value={traitInput}
                      onChange={(e) => setTraitInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && traitInput.trim()) {
                          e.preventDefault();
                          setForm({ ...form, traits: [...form.traits, traitInput.trim()] });
                          setTraitInput('');
                        }
                      }}
                      sx={{ flex: 1, '& .MuiInputBase-root': { height: 28, fontSize: '0.65rem' } }} />
                    <Button size="small" variant="outlined" disabled={!traitInput.trim()}
                      onClick={() => { setForm({ ...form, traits: [...form.traits, traitInput.trim()] }); setTraitInput(''); }}
                      sx={{ minWidth: 'auto', px: 1, fontSize: '0.6rem', textTransform: 'none', height: 28,
                        borderColor: alphaColor(crewTheme.accent.purple, '50'), color: crewTheme.accent.purple }}>
                      Add
                    </Button>
                  </Box>
                </Box>
              </>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, pb: 2, borderTop: `1px solid ${crewTheme.border.subtle}`, justifyContent: 'space-between' }}>
        <Button
          onClick={() => {
            setLocalError('');
            if (step === 'template') handleClose();
            else if (step === 'domain') setStep('template');
            else setStep('domain');
          }}
          sx={{ color: crewTheme.text.dim, fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace" }}
        >
          {step === 'template' ? 'CANCEL' : 'BACK'}
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {step === 'template' && (
            <Button onClick={goDomain} variant="contained"
              sx={{ bgcolor: crewTheme.accent.tactical, color: crewTheme.bg.void, fontSize: '0.7rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", px: 2.5,
                '&:hover': { bgcolor: alphaColor(crewTheme.accent.tactical, 0.85) } }}>
              NEXT
            </Button>
          )}
          {step === 'domain' && (
            <Button onClick={goDetails} variant="contained"
              sx={{ bgcolor: crewTheme.accent.tactical, color: crewTheme.bg.void, fontSize: '0.7rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", px: 2.5,
                '&:hover': { bgcolor: alphaColor(crewTheme.accent.tactical, 0.85) } }}>
              NEXT
            </Button>
          )}
          {step === 'details' && (
            <Button onClick={() => void handleDeploy()} disabled={busy} variant="contained"
              sx={{ bgcolor: crewTheme.accent.tactical, color: crewTheme.bg.void, fontSize: '0.7rem', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", px: 2.5,
                '&:hover': { bgcolor: alphaColor(crewTheme.accent.tactical, 0.85) } }}>
              {busy ? <CircularProgress size={14} sx={{ mr: 1 }} /> : null}
              DEPLOY
            </Button>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
}
