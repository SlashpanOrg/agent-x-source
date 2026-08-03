import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Modal from '@mui/material/Modal';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import SaveIcon from '@mui/icons-material/Save';
import { voice } from '../../api';
import { ThinkingOrb } from 'thinking-orbs';
import { getActiveScheme } from '../../theme';
import {
  settingsBtnGhostSx,
  settingsBtnPrimarySx,
  settingsHelperSx,
  settingsTheme,
} from '../../styles/settings-theme';

interface AddSpeakerProfileModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  profileId?: string;
  profileName?: string;
}

function floatTo16BitPcm(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

function bufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

type Phase = 'idle' | 'recording' | 'processing' | 'naming' | 'error';

export function AddSpeakerProfileModal({ open, onClose, onSaved, profileId, profileName }: AddSpeakerProfileModalProps) {
  const isAddingSample = Boolean(profileId);
  const [passage, setPassage] = useState('');
  const [passageLoading, setPassageLoading] = useState(false);
  const [passageError, setPassageError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [name, setName] = useState(profileName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pcmBase64, setPcmBase64] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('idle');
    setError(null);
    setPassageError(null);
    setName('');
    setPcmBase64('');
    setRecordSeconds(0);
    setPassage('');
    setPassageLoading(true);

    voice.passage()
      .then((res) => {
        setPassage(res.text);
        if (res.fallback) {
          setPassageError(res.error ?? 'Using fallback passage — LLM not available.');
        }
      })
      .catch(() => {
        setPassage('The quick brown fox jumps over the lazy dog.');
        setPassageError('Using fallback passage — LLM not available.');
      })
      .finally(() => setPassageLoading(false));

    return () => {
      stopAudio(true);
    };
  }, [open]);

  const stopAudio = (clear = false) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    if (clear) chunksRef.current = [];
  };

  useEffect(() => {
    if (phase !== 'recording' || !analyserRef.current) return;
    drawWaveform();
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [phase]);

  const drawWaveform = () => {
    if (rafRef.current) return; // already drawing
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = 320;
    const h = 80;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const color = settingsTheme.accent.hud;

    const draw = () => {
      // Stop if the analyser has been torn down (e.g. recording stopped).
      if (!analyserRef.current) return;
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, w, h);

      // Centre line
      ctx.beginPath();
      ctx.strokeStyle = `${settingsTheme.text.dim}44`;
      ctx.lineWidth = 1;
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Voice wave
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      const slice = w / data.length;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]! - 128) / 128; // -1 .. 1
        const y = h / 2 + v * (h * 0.42);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      }
      ctx.stroke();

      // Mirror glow
      ctx.beginPath();
      ctx.strokeStyle = `${color}55`;
      ctx.lineWidth = 1;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]! - 128) / 128;
        const y = h / 2 - v * (h * 0.18);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      }
      ctx.stroke();
    };

    draw();
  };

  const startRecording = async () => {
    setError(null);
    chunksRef.current = [];
    setRecordSeconds(0);
    setPcmBase64('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16_000 });
      audioContextRef.current = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const source = ctx.createMediaStreamSource(stream);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(data));
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      setPhase('recording');

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1_000);
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Microphone setup failed');
      stopAudio(true);
    }
  };

  const stopRecording = async () => {
    stopAudio(false);
    setPhase('processing');

    const total = chunksRef.current.reduce((n, c) => n + c.length, 0);
    if (total === 0) {
      setPhase('error');
      setError('No audio recorded');
      return;
    }
    const combined = new Float32Array(total);
    let off = 0;
    for (const c of chunksRef.current) {
      combined.set(c, off);
      off += c.length;
    }
    const pcm = floatTo16BitPcm(combined);
    const b64 = bufferToBase64(pcm.buffer);
    setPcmBase64(b64);

    try {
      // Process/validate the audio first before asking for a name.
      await voice.identifySpeaker(b64);
      if (isAddingSample) {
        // Adding a sample to an existing profile — save immediately.
        await voice.addSpeakerSample(profileId!, b64);
        onSaved();
        onClose();
      } else {
        setPhase('naming');
      }
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Voice processing failed');
    } finally {
      chunksRef.current = [];
    }
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed || !pcmBase64) return;
    setPhase('processing');
    try {
      await voice.addSpeaker(trimmed, pcmBase64, false);
      onSaved();
      onClose();
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Failed to save voiceprint');
    }
  };

  const handleClose = () => {
    stopAudio(true);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: { xs: '90vw', sm: 420 },
        maxHeight: '90vh',
        overflow: 'auto',
        bgcolor: settingsTheme.bg.elevated,
        border: `1px solid ${settingsTheme.border.default}`,
        borderRadius: 1.5,
        boxShadow: 24,
        p: 2.5,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
          <Typography sx={{ ...settingsHelperSx, fontSize: '0.85rem', color: settingsTheme.text.primary, fontWeight: 600 }}>
            Add Voice Profile
          </Typography>
          <Button onClick={handleClose} sx={{ ...settingsBtnGhostSx, minWidth: 0, p: 0.5 }}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </Button>
        </Box>

        {(phase === 'idle' || phase === 'recording') && (
          <>
            <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', color: settingsTheme.text.dim, mb: 1 }}>
              {passageLoading ? 'Thinking up a new passage…' : 'Read this passage aloud to enrol your voiceprint.'}
            </Typography>
            <Box sx={{
              p: 1.25,
              border: `1px solid ${settingsTheme.border.default}`,
              borderRadius: 1,
              bgcolor: `${settingsTheme.bg.panel}80`,
              mb: 2,
              minHeight: 80,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
            }}>
              {passageLoading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ThinkingOrb
                    state="working"
                    size={20}
                    theme={getActiveScheme() === 'dark' ? 'dark' : 'light'}
                    aria-label="Thinking…"
                    style={{ flexShrink: 0 }}
                  />
                  <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem', color: settingsTheme.text.dim }}>
                    Thinking…
                  </Typography>
                </Box>
              )}
              <Typography sx={{
                ...settingsHelperSx,
                fontSize: '0.72rem',
                color: settingsTheme.text.primary,
                textAlign: 'center',
                fontStyle: 'italic',
              }}>
                {passage || 'The quick brown fox jumps over the lazy dog.'}
              </Typography>
              {passageError && (
                <Typography sx={{ ...settingsHelperSx, fontSize: '0.55rem', color: settingsTheme.accent.amber, textAlign: 'center' }}>
                  {passageError}
                </Typography>
              )}
            </Box>
          </>
        )}

        {phase === 'recording' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2 }}>
            <Box sx={{
              border: `1px solid ${settingsTheme.border.default}`,
              borderRadius: 1,
              bgcolor: `${settingsTheme.bg.panel}80`,
              p: 1,
              mb: 1,
            }}>
              <canvas ref={canvasRef} />
            </Box>
            <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem', color: settingsTheme.accent.hud }}>
              Recording… {recordSeconds}s
            </Typography>
          </Box>
        )}

        {phase === 'processing' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2 }}>
            <ThinkingOrb
              state="working"
              size={64}
              theme={getActiveScheme() === 'dark' ? 'dark' : 'light'}
              aria-label="Analysing…"
            />
            <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem', color: settingsTheme.accent.amber, mt: 1 }}>
              Analysing voice…
            </Typography>
          </Box>
        )}

        {phase === 'naming' && !isAddingSample && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', color: settingsTheme.text.dim, mb: 1 }}>
              Voice processed successfully. What would you like to call this profile?
            </Typography>
            <TextField
              fullWidth
              size="small"
              placeholder="Profile name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              sx={{
                '& .MuiInputBase-root': { fontSize: '0.7rem', py: 0.5 },
              }}
            />
          </Box>
        )}

        {phase === 'error' && (
          <Box sx={{ mb: 2 }}>
            <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', color: settingsTheme.accent.alert, mb: 1 }}>
              {error}
            </Typography>
            <Button
              onClick={() => setPhase('idle')}
              sx={{ ...settingsBtnGhostSx, fontSize: '0.62rem', py: 0.45 }}
            >
              Try again
            </Button>
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          {phase === 'idle' && (
            <Button
              onClick={() => void startRecording()}
              disabled={passageLoading || !passage.trim()}
              startIcon={<MicIcon sx={{ fontSize: 14 }} />}
              sx={{ ...settingsBtnPrimarySx, fontSize: '0.62rem', py: 0.45 }}
            >
              Start recording
            </Button>
          )}
          {phase === 'recording' && (
            <Button
              onClick={() => void stopRecording()}
              startIcon={<StopIcon sx={{ fontSize: 14 }} />}
              sx={{ ...settingsBtnPrimarySx, fontSize: '0.62rem', py: 0.45 }}
            >
              Stop ({recordSeconds}s)
            </Button>
          )}
          {phase === 'naming' && !isAddingSample && (
            <Button
              onClick={() => void handleSave()}
              disabled={!name.trim()}
              startIcon={<SaveIcon sx={{ fontSize: 14 }} />}
              sx={{ ...settingsBtnPrimarySx, fontSize: '0.62rem', py: 0.45 }}
            >
              Save
            </Button>
          )}
        </Box>
      </Box>
    </Modal>
  );
}
