import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import ScienceIcon from '@mui/icons-material/Science';
import { voice } from '../../api';
import {
  settingsBtnPrimarySx,
  settingsHelperSx,
  settingsMonoSx,
  settingsTheme,
} from '../../styles/settings-theme';
import { colors, alphaColor, MONO } from '../../theme';

interface SpoofLabModalProps {
  open: boolean;
  onClose: () => void;
  ecapaInstalled: boolean;
  threshold?: number;
}

interface Match {
  speakerId: string | null;
  speakerName?: string | null;
  confidence: number | null;
  isRoot?: boolean;
}

function floatTo16BitPcm(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

function bufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function SpoofLabModal({ open, onClose, ecapaInstalled, threshold = 0.55 }: SpoofLabModalProps) {
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [analysing, setAnalysing] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !ecapaInstalled) return;
    setError(null);
    setMatches([]);
    setRecordSeconds(0);
    setRecording(false);
    setAnalysing(false);
  }, [open, ecapaInstalled]);

  useEffect(() => () => { void cleanup(); }, []);

  const cleanup = async () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    processorRef.current?.disconnect();
    processorRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  };

  const drawWaveform = () => {
    if (rafRef.current) return;
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const color = colors.text.primary;

    const draw = () => {
      if (!analyserRef.current) return;
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, w, h);

      // HUD grid lines
      ctx.strokeStyle = `${settingsTheme.border.default}66`;
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Voice wave
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      const slice = w / data.length;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]! - 128) / 128;
        const y = h / 2 + v * (h * 0.42);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      }
      ctx.stroke();

      // Glow mirror
      ctx.beginPath();
      ctx.strokeStyle = `${color}77`;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i]! - 128) / 128;
        const y = h / 2 - v * (h * 0.25);
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      }
      ctx.stroke();
    };

    draw();
  };

  const startRecording = async () => {
    setError(null);
    setMatches([]);
    chunksRef.current = [];
    setRecordSeconds(0);
    setRecording(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16_000 });
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      drawWaveform();

      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1_000);
    } catch (err) {
      setRecording(false);
      setError(err instanceof Error ? err.message : 'Microphone access denied');
      void cleanup();
    }
  };

  const stopRecording = async () => {
    await cleanup();
    setRecording(false);
    const total = chunksRef.current.reduce((n, c) => n + c.length, 0);
    if (total === 0) {
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
    const pcmBase64 = bufferToBase64(pcm.buffer);
    setAnalysing(true);
    try {
      const res = await voice.identifySpeaker(pcmBase64, threshold);
      setMatches(res.matches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalysing(false);
      chunksRef.current = [];
    }
  };

  const topMatch = matches[0] ?? null;
  const recognized = topMatch && (topMatch.confidence ?? 0) >= threshold;

  return (
    <Dialog
      open={open}
      onClose={recording ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: colors.bg.secondary,
            border: `1px solid ${settingsTheme.accent.hud}`,
            borderRadius: 1.5,
            boxShadow: `0 0 40px ${alphaColor(settingsTheme.accent.hud, '0.25')}`,
            overflow: 'hidden',
          },
        },
        backdrop: { sx: { bgcolor: 'rgba(0,0,0,0.75)' } },
      }}
    >
      <Box sx={{ p: 2.5, position: 'relative' }}>
        <IconButton
          onClick={onClose}
          disabled={recording}
          size="small"
          sx={{ position: 'absolute', top: 12, right: 12, color: settingsTheme.text.dim }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <ScienceIcon sx={{ fontSize: 20, color: settingsTheme.accent.hud }} />
          <Typography sx={{ fontFamily: MONO, fontSize: '0.85rem', letterSpacing: '0.08em', color: settingsTheme.text.primary }}>
            SPOOF LAB
          </Typography>
        </Box>

        <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', color: settingsTheme.text.dim, mb: 2 }}>
          Record a voice clip and compare it to all enrolled voiceprints using the current confidence threshold ({Math.round(threshold * 100)}%).
        </Typography>

        {!ecapaInstalled && (
          <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', color: settingsTheme.accent.alert }}>
            ECAPA model is not installed. Deploy the voice kit to use the Spoof Lab.
          </Typography>
        )}

        {ecapaInstalled && (
          <>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                py: 2,
                px: 1,
                mb: 2,
                borderRadius: 1,
                border: `1px solid ${recording ? settingsTheme.accent.alert : settingsTheme.border.hud}`,
                bgcolor: recording ? alphaColor(settingsTheme.accent.alert, '0.08') : settingsTheme.bg.hud,
                position: 'relative',
                minHeight: 180,
                transition: 'border-color 0.2s, background-color 0.2s',
              }}
            >
              {recording ? (
                <>
                  <Box sx={{
                    width: '100%',
                    height: 120,
                    borderRadius: 1,
                    bgcolor: colors.bg.tertiary,
                    mb: 1,
                    overflow: 'hidden',
                  }}>
                    <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                  </Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.8rem', color: settingsTheme.accent.alert, mb: 0.5 }}>
                    RECORDING {recordSeconds}s
                  </Typography>
                </>
              ) : (
                <>
                  <Box
                    sx={{
                      width: 72,
                      height: 72,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      bgcolor: alphaColor(settingsTheme.accent.hud, '0.12'),
                      border: `1px solid ${settingsTheme.accent.hud}`,
                      mb: 1.5,
                    }}
                  >
                    <MicIcon sx={{ fontSize: 28, color: settingsTheme.accent.hud }} />
                  </Box>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.7rem', color: settingsTheme.text.dim, mb: 1 }}>
                    READY TO RECORD
                  </Typography>
                </>
              )}

              {recording ? (
                <Button
                  onClick={() => void stopRecording()}
                  startIcon={<StopIcon sx={{ fontSize: 16 }} />}
                  sx={{ ...settingsBtnPrimarySx, fontSize: '0.65rem', px: 2, py: 0.6 }}
                >
                  Stop & Analyse
                </Button>
              ) : (
                <Button
                  onClick={() => void startRecording()}
                  disabled={analysing}
                  startIcon={<MicIcon sx={{ fontSize: 14 }} />}
                  sx={{ ...settingsBtnPrimarySx, fontSize: '0.65rem', px: 2, py: 0.6 }}
                >
                  Record Sample
                </Button>
              )}
            </Box>

            {analysing && (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                  <Typography sx={{ ...settingsMonoSx, fontSize: '0.6rem', color: settingsTheme.accent.hud }}>
                    ANALYSING
                  </Typography>
                </Box>
                <LinearProgress
                  sx={{
                    height: 4,
                    borderRadius: 1,
                    bgcolor: alphaColor(settingsTheme.border.default, '0.6'),
                    '& .MuiLinearProgress-bar': { bgcolor: settingsTheme.accent.hud },
                  }}
                />
              </Box>
            )}

            {matches.length > 0 && (
              <Box
                sx={{
                  p: 1.5,
                  borderRadius: 1,
                  border: `1px solid ${recognized ? settingsTheme.accent.alert : settingsTheme.border.default}`,
                  bgcolor: recognized ? alphaColor(settingsTheme.accent.alert, '0.08') : settingsTheme.bg.hud,
                  mb: 1.5,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Typography sx={{ fontFamily: MONO, fontSize: '0.75rem', color: settingsTheme.text.primary }}>
                    {recognized ? 'MATCH DETECTED' : 'NO MATCH ABOVE THRESHOLD'}
                  </Typography>
                  <Typography sx={{ ...settingsHelperSx, fontSize: '0.55rem', color: settingsTheme.text.dim }}>
                    Threshold {Math.round(threshold * 100)}%
                  </Typography>
                </Box>

                {recognized && (
                  <Box sx={{ mb: 1.5, p: 1, borderRadius: 1, bgcolor: colors.bg.tertiary }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography sx={{ ...settingsMonoSx, fontSize: '0.7rem', color: settingsTheme.text.primary }}>
                        {topMatch?.speakerName ?? 'Unknown'} {topMatch?.isRoot ? '(ROOT)' : ''}
                      </Typography>
                      <Typography sx={{ ...settingsMonoSx, fontSize: '0.7rem', color: settingsTheme.accent.alert }}>
                        {Math.round((topMatch?.confidence ?? 0) * 100)}%
                      </Typography>
                    </Box>
                    <Box sx={{ height: 6, borderRadius: 1, bgcolor: alphaColor(settingsTheme.border.default, '0.5'), overflow: 'hidden' }}>
                      <Box
                        sx={{
                          height: '100%',
                          width: `${Math.min(100, Math.max(0, (topMatch?.confidence ?? 0) * 100))}%`,
                          bgcolor: settingsTheme.accent.alert,
                          transition: 'width 0.6s ease-out',
                        }}
                      />
                    </Box>
                  </Box>
                )}

                <Typography sx={{ ...settingsHelperSx, fontSize: '0.6rem', color: settingsTheme.text.dim, mb: 1 }}>
                  {recognized ? 'Top closest matches' : 'Closest matches below threshold'}
                </Typography>

                {matches.slice(recognized ? 1 : 0, recognized ? 6 : 5).map((m, i) => (
                  <Box
                    key={m.speakerId ?? i}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      py: 0.5,
                      borderBottom: `1px solid ${i === (matches.slice(recognized ? 1 : 0, recognized ? 6 : 5).length - 1) ? 'transparent' : settingsTheme.border.default}`,
                    }}
                  >
                    <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.primary }}>
                      #{i + 1} {m.speakerName ?? 'Unknown'} {m.isRoot ? '(ROOT)' : ''}
                    </Typography>
                    <Typography sx={{ ...settingsMonoSx, fontSize: '0.65rem', color: settingsTheme.text.secondary }}>
                      {Math.round((m.confidence ?? 0) * 100)}%
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}

            {error && (
              <Typography sx={{ ...settingsHelperSx, fontSize: '0.62rem', color: settingsTheme.accent.alert }}>
                {error}
              </Typography>
            )}
          </>
        )}
      </Box>
    </Dialog>
  );
}
