from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any
from uuid import uuid4


class SpeakerStore:
    """Simple on-disk JSONL store for enrolled speaker profiles.

    Profiles can hold multiple voiceprint samples. Each sample stores its
    own 192-dim embedding and the original PCM audio, so the sidecar can
    compare an incoming utterance against every enrolled sample.
    """

    def __init__(self, data_dir: str) -> None:
        self.profiles_path = Path(data_dir) / "voiceprints" / "profiles.jsonl"
        self.profiles_path.parent.mkdir(parents=True, exist_ok=True)
        self._profiles: list[dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        if not self.profiles_path.exists():
            return
        try:
            with self.profiles_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        self._profiles.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except OSError:
            pass

    def _save(self) -> None:
        with self.profiles_path.open("w", encoding="utf-8") as f:
            for profile in self._profiles:
                f.write(json.dumps(profile, ensure_ascii=False) + "\n")

    def list(self) -> list[dict[str, Any]]:
        return self._profiles

    def _now(self) -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()

    def add_sample(self, name: str, is_root: bool, embedding: list[float], sample_b64: str, sample_rate: int = 16_000, profile_id: str | None = None) -> dict[str, Any]:
        sample_id = str(uuid4())
        sample = {
            "id": sample_id,
            "embedding": embedding,
            "sampleB64": sample_b64,
            "sampleRate": sample_rate,
            "createdAt": self._now(),
        }

        if profile_id:
            for profile in self._profiles:
                if profile.get("id") == profile_id:
                    profile.setdefault("samples", []).append(sample)
                    # Mirror the latest sample in legacy fields for backward compat.
                    profile["embedding"] = embedding
                    profile["sampleB64"] = sample_b64
                    profile["sampleRate"] = sample_rate
                    profile["updatedAt"] = self._now()
                    self._save()
                    return profile

        profile = {
            "id": str(uuid4()),
            "name": name,
            "isRoot": is_root,
            "samples": [sample],
            "embedding": embedding,
            "sampleB64": sample_b64,
            "sampleRate": sample_rate,
            "createdAt": self._now(),
            "updatedAt": self._now(),
        }
        self._profiles.append(profile)
        self._save()
        return profile

    def update(self, profile_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        for profile in self._profiles:
            if profile.get("id") == profile_id:
                profile.update(updates)
                profile["updatedAt"] = self._now()
                self._save()
                return profile
        return None

    def delete_sample(self, profile_id: str, sample_id: str) -> bool:
        for profile in self._profiles:
            if profile.get("id") != profile_id:
                continue
            samples = profile.get("samples") or []
            before = len(samples)
            samples = [s for s in samples if s.get("id") != sample_id]
            if len(samples) == before:
                return False
            if not samples:
                self._profiles = [p for p in self._profiles if p.get("id") != profile_id]
                self._save()
                return True
            profile["samples"] = samples
            # Mirror the most recent remaining sample into legacy fields.
            latest = samples[-1]
            profile["embedding"] = latest.get("embedding")
            profile["sampleB64"] = latest.get("sampleB64")
            profile["sampleRate"] = latest.get("sampleRate")
            profile["updatedAt"] = self._now()
            self._save()
            return True
        return False

    def set_root(self, profile_id: str) -> dict[str, Any] | None:
        for profile in self._profiles:
            profile["isRoot"] = (profile.get("id") == profile_id)
        self._save()
        for profile in self._profiles:
            if profile.get("id") == profile_id:
                return profile
        return None

    def delete(self, profile_id: str) -> bool:
        before = len(self._profiles)
        self._profiles = [p for p in self._profiles if p.get("id") != profile_id]
        if len(self._profiles) != before:
            self._save()
            return True
        return False

    def get_root(self) -> dict[str, Any] | None:
        for profile in self._profiles:
            if profile.get("isRoot"):
                return profile
        return self._profiles[0] if self._profiles else None

    def get(self, profile_id: str) -> dict[str, Any] | None:
        for profile in self._profiles:
            if profile.get("id") == profile_id:
                return profile
        return None

    @staticmethod
    def decode_pcm_b64(b64: str) -> bytes:
        return base64.b64decode(b64)
