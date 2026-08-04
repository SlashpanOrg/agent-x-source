from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torchaudio


class SpeakerEmbedder:
    """SpeechBrain ECAPA-TDNN speaker embedding wrapper.

    Loads the ECAPA model from a local path (downloaded as a voice asset) and
    extracts 192-dimensional speaker embeddings from raw PCM bytes.
    """

    def __init__(self, data_dir: str) -> None:
        self.data_dir = Path(data_dir)
        self.model_dir = self.data_dir / "models" / "speaker" / "speechbrain-ecapa"
        self._classifier: Any | None = None
        self._loaded = False

    def _try_load(self) -> None:
        if self._loaded:
            return
        if not self.model_dir.exists():
            raise RuntimeError(f"ECAPA model not found at {self.model_dir}. Run the voice asset download first.")

        # Silence the very verbose SpeechBrain download messages.
        import speechbrain.utils.logger as sb_logger
        sb_logger.get_logger("speechbrain").setLevel("WARNING")

        from speechbrain.pretrained import EncoderClassifier

        self._classifier = EncoderClassifier.from_hparams(
            source=str(self.model_dir),
            savedir=str(self.model_dir),
            hparams_file="hyperparams.yaml",
        )
        self._loaded = True

    def _pcm_to_tensor(self, pcm: bytes, sample_rate: int) -> torch.Tensor:
        """Convert raw 16-bit mono PCM bytes to a 16 kHz mono float tensor."""
        if len(pcm) % 2 != 0:
            raise ValueError("PCM buffer must contain an even number of bytes (16-bit samples)")
        if len(pcm) == 0:
            raise ValueError("Empty audio provided")

        wav = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0

        if wav.ndim > 1:
            wav = wav.mean(axis=1)

        wav = torch.from_numpy(wav).unsqueeze(0)

        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=16000)
            wav = resampler(wav)

        return wav

    def extract(self, pcm: bytes, sample_rate: int) -> list[float]:
        """Extract a 192-dim speaker embedding from raw PCM bytes."""
        self._try_load()

        wav = self._pcm_to_tensor(pcm, sample_rate)
        with torch.no_grad():
            embeddings = self._classifier.encode_batch(wav)

        # embeddings is [batch, 1, features]; squeeze to [features]
        embedding = embeddings.squeeze().cpu().numpy()
        return embedding.astype(float).tolist()

    def compare(self, query: list[float], enrolled: list[dict[str, Any]], threshold: float = 0.55, top_k: int = 5) -> dict[str, Any]:
        """Compare a query embedding to a list of enrolled embeddings.

        Returns the best matching profile, the highest cosine-similarity score
        across all samples for that profile, whether it passes the threshold,
        and a ranked list of the top-k closest profile matches.
        """
        if not enrolled:
            return {"matchId": None, "confidence": None, "passed": False, "matches": []}

        q = np.array(query, dtype=np.float32)
        q = q / (np.linalg.norm(q) + 1e-8)

        # Aggregate the best score per profile across all of its samples.
        best_by_id: dict[str, float] = {}
        for profile in enrolled:
            profile_id = profile.get("id")
            if not profile_id:
                continue
            emb = np.array(profile.get("embedding", []), dtype=np.float32)
            if emb.size == 0:
                continue
            emb = emb / (np.linalg.norm(emb) + 1e-8)
            score = float(np.dot(q, emb))
            best_by_id[profile_id] = max(best_by_id.get(profile_id, -1.0), score)

        if not best_by_id:
            return {"matchId": None, "confidence": None, "passed": False, "matches": []}

        scores = [{"id": pid, "confidence": round(conf, 4)} for pid, conf in best_by_id.items()]
        scores.sort(key=lambda x: x["confidence"], reverse=True)
        top = scores[:top_k]
        best = top[0]

        return {
            "matchId": best["id"],
            "confidence": best["confidence"],
            "passed": best["confidence"] >= threshold,
            "matches": top,
        }
