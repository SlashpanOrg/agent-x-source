from __future__ import annotations

import base64
import logging
import re
import time
import zipfile
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

# Python 3.13+ zipfile enforces strict entry overlap checks by default, which
# rejects some legitimate .npz voice bundle files. Force strict=False globally
# so Kokoro's voices-v1.0.bin loads without raising a "possible zip bomb" error.
if 'strict' in (zipfile.ZipFile.__init__.__code__.co_varnames or ()):
    _orig_zipfile_init = zipfile.ZipFile.__init__
    def _patched_zipfile_init(self, *args, **kwargs):
        kwargs.setdefault('strict', False)
        return _orig_zipfile_init(self, *args, **kwargs)
    zipfile.ZipFile.__init__ = _patched_zipfile_init

_LOGGER = logging.getLogger(__name__)


_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


class KokoroTts:
    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)
        self.pipeline = None

    def warm(self, request: dict[str, Any]) -> None:
        self._load()

    def unload(self) -> None:
        self.pipeline = None

    def synthesize(self, request: dict[str, Any]) -> dict[str, Any]:
        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        output_path = request.get("outputPath")
        if not isinstance(output_path, str) or not output_path:
            tmp_dir = self.data_dir / "tmp"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            output_path = str(tmp_dir / f"kokoro-{int(time.time() * 1000)}.wav")

        started = time.perf_counter()
        kokoro = self._load()
        voice_id = str(request.get("voiceId") or "kokoro-af")
        kokoro_voice = _resolve_voice_id(kokoro, voice_id)
        lang = _resolve_lang(kokoro_voice)

        try:
            import numpy as np
            import soundfile as sf
        except ImportError as exc:
            raise RuntimeError("numpy and soundfile are required for Kokoro synthesis.") from exc

        samples, sample_rate = kokoro.create(
            text, voice=kokoro_voice, speed=1.0, lang=lang
        )
        sf.write(output_path, samples, sample_rate)
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "audioPath": output_path,
            "sampleRate": sample_rate,
            "durationMs": int(len(samples) / sample_rate * 1000),
            "timings": {"synthesizeMs": elapsed_ms},
        }

    def synthesize_stream(self, request: dict[str, Any], cancel_check: Callable[[], bool] | None = None) -> Iterator[dict[str, Any]]:
        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        t0 = time.perf_counter()
        kokoro = self._load()
        t_load = time.perf_counter()
        voice_id = str(request.get("voiceId") or "kokoro-af")
        kokoro_voice = _resolve_voice_id(kokoro, voice_id)
        lang = _resolve_lang(kokoro_voice)

        first_chunk_at = None
        chunk_index = 0
        for sentence in _split_sentences(text):
            if cancel_check and cancel_check():
                break
            t_synth = time.perf_counter()
            samples, sample_rate = kokoro.create(
                sentence, voice=kokoro_voice, speed=1.0, lang=lang
            )
            pcm = _float_audio_to_pcm16(samples)
            t_emit = time.perf_counter()
            if first_chunk_at is None:
                first_chunk_at = t_emit
            yield {
                "pcmBase64": base64.b64encode(pcm).decode("ascii"),
                "sampleRate": sample_rate,
                "timings": {
                    "loadMs": round((t_load - t0) * 1000, 1),
                    "firstChunkMs": round((first_chunk_at - t0) * 1000, 1) if first_chunk_at else None,
                    "synthMs": round((t_emit - t_synth) * 1000, 1),
                    "chunkIndex": chunk_index,
                    "textChars": len(sentence),
                },
            }
            chunk_index += 1

    def _load(self):
        if self.pipeline is not None:
            return self.pipeline

        model_dir = self.data_dir / "models" / "tts" / "kokoro" / "kokoro-onnx"
        model_path = model_dir / "kokoro-v1.0.onnx"
        voices_path = model_dir / "voices-v1.0.bin"

        if not model_path.exists():
            raise FileNotFoundError("Kokoro ONNX model is not installed")
        if not voices_path.exists():
            raise FileNotFoundError(f"Kokoro voices file not found at {voices_path}")

        try:
            from kokoro_onnx import Kokoro
        except ImportError as exc:
            raise RuntimeError("kokoro-onnx is not installed. Install sidecar dependencies first.") from exc

        self.pipeline = Kokoro(str(model_path), str(voices_path))
        return self.pipeline


_KOKORO_VOICE_ALIASES = {
    # Legacy alias — keep for backward compatibility with existing configs
    "kokoro-af": "af_heart",
    "default": "af_heart",
}


def _resolve_lang(voice_id: str) -> str:
    """American vs British pipeline — matches Kokoro voice prefix conventions."""
    v = voice_id.strip().lower()
    if v.startswith("bf_") or v.startswith("bm_"):
        return "en-gb"
    return "en-us"


def _resolve_voice_id(kokoro: Any, voice_id: str) -> str:
    """Map aliases and ensure the requested voice exists in the loaded voices.bin.

    Voice profiles can be set dynamically (per-crew, per-callsign, or via settings).
    If the requested voice is not available in the installed model, fall back to
    `af_heart` or the first available voice so TTS never aborts mid-turn.
    """
    requested = voice_id.strip().lower()
    canonical = _KOKORO_VOICE_ALIASES.get(requested, requested)

    # Prefer case as returned by kokoro_onnx, but do a case-insensitive membership check
    # because config/UI values may differ in casing.
    available = getattr(kokoro, "voices", None) or []
    by_lower = {str(v).lower(): str(v) for v in available}

    if canonical in by_lower:
        return by_lower[canonical]

    if canonical != requested:
        _LOGGER.warning(
            "Kokoro voice %r (alias for %r) is not available in voices.bin; "
            "falling back to the bundled default voice.",
            voice_id,
            canonical,
        )

    fallback = by_lower.get("af_heart") or (available[0] if available else "af_heart")
    _LOGGER.warning(
        "Kokoro voice %r is not available in voices.bin; "
        "falling back to %r. Available voices: %s",
        voice_id,
        fallback,
        ", ".join(str(v) for v in available[:10]) + ("..." if len(available) > 10 else ""),
    )
    return fallback


def _split_sentences(text: str) -> list[str]:
    """Short utterances stay one phoneme pass — better prosody for fillers and replies."""
    stripped = text.strip()
    if len(stripped) <= 280:
        return [stripped]
    parts = [part.strip() for part in _SENTENCE_RE.split(stripped) if part.strip()]
    return parts or [stripped]


def _float_audio_to_pcm16(audio: Any) -> bytes:
    import numpy as np

    clipped = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    pcm16 = (clipped * 32767.0).astype(np.int16)
    return pcm16.tobytes()
