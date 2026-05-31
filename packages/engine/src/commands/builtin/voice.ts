import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CommandInterface, CommandContext, CommandResult } from '../CommandInterface.js';

// Check which recording tools are available
function hasTool(tool: string): boolean {
  try {
    execSync(`which ${tool}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function recordAudio(filePath: string, duration: number): Promise<boolean> {
  const tools = [
    { cmd: 'rec', args: ['-q', '-r', '16000', '-c', '1', filePath, 'trim', '0', String(duration)] },
    { cmd: 'ffmpeg', args: ['-f', 'avfoundation', '-i', ':0', '-t', String(duration), '-ar', '16000', '-ac', '1', filePath] },
    { cmd: 'sox', args: ['-q', '-d', '-r', '16000', '-c', '1', filePath, 'trim', '0', String(duration)] },
  ];

  for (const tool of tools) {
    if (!hasTool(tool.cmd)) continue;
    try {
      execSync(`${tool.cmd} ${tool.args.join(' ')}`, { stdio: 'pipe', timeout: (duration + 5) * 1000 });
      return existsSync(filePath);
    } catch {
      continue;
    }
  }
  return false;
}

async function transcribeWhisper(filePath: string, apiKey?: string): Promise<string> {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OpenAI API key required for transcription. Set OPENAI_API_KEY.');
  const { readFileSync } = await import('node:fs');
  const { extname } = await import('node:path');

  const audioBuffer = readFileSync(filePath);
  const ext = extname(filePath).slice(1) || 'wav';
  const contentType = ext === 'mp3' ? 'audio/mpeg' : ext === 'wav' ? 'audio/wav' : ext === 'ogg' ? 'audio/ogg' : 'audio/wav';

  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: contentType }), `audio.${ext}`);
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const data = await res.json() as { text?: string; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.text ?? '';
}

export const voiceCommand: CommandInterface = {
  name: 'voice',
  description: 'Record and transcribe voice input',
  usage: '/voice [duration=5]',
  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    const duration = Math.min(Math.max(parseInt(args[0] ?? '5', 10) || 5, 1), 30);
    const filePath = join(tmpdir(), `agentx-voice-${Date.now()}.wav`);

    if (!hasTool('rec') && !hasTool('ffmpeg') && !hasTool('sox')) {
      context.emit('Voice recording requires `rec` (sox), `ffmpeg`, or `sox` to be installed.\n  macOS: brew install sox\n  Linux: apt install sox\n  Windows: choco install sox');
      return { success: false, action: 'none' };
    }

    context.emit(`🎙 Recording for ${duration}s... Speak now.`);
    const ok = await recordAudio(filePath, duration);
    if (!ok) {
      context.emit('Recording failed. Ensure a microphone is connected and a recording tool is installed.');
      return { success: false, action: 'none' };
    }

    context.emit('⏳ Transcribing...');
    try {
      const text = await transcribeWhisper(filePath);
      if (!text.trim()) {
        context.emit('No speech detected.');
        return { success: true, action: 'none' };
      }
      context.emit(`📝 Transcription: ${text}\n\nSend this as a message? Press Enter to confirm, Esc to cancel.`);
      return { success: true, action: 'none', output: text };
    } catch (e) {
      context.emit(`Transcription failed: ${(e as Error).message}`);
      return { success: false, action: 'none' };
    } finally {
      try { unlinkSync(filePath); } catch { /* ignore */ }
    }
  },
};
