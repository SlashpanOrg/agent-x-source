from __future__ import annotations

import argparse
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import deque
from typing import Any, Literal
from urllib.parse import urlparse, parse_qs
import base64
import logging

from agentx_voice import __version__
from agentx_voice.protocol import SidecarConfig, health_payload
from agentx_voice.speaker_embedder import SpeakerEmbedder
from agentx_voice.speaker_store import SpeakerStore
from agentx_voice.stt_faster_whisper import FasterWhisperStt
from agentx_voice.tts_kokoro import KokoroTts
from agentx_voice.vad_silero import SileroVad

_LOGGER = logging.getLogger(__name__)

TtsEngine = Literal["kokoro"]


class VoiceRuntime:
    def __init__(self, config: SidecarConfig) -> None:
        self.config = config
        self.stt = FasterWhisperStt(config.data_dir)
        self.kokoro = KokoroTts(config.data_dir)
        self.vad = SileroVad(config.data_dir)
        self.speaker = SpeakerEmbedder(config.data_dir)
        self.speaker_store = SpeakerStore(config.data_dir)
        self.active_tts_engine: TtsEngine = "kokoro"
        self.cancelled_request_ids: deque[str] = deque(maxlen=500)

    def cancel(self, request: dict[str, Any]) -> dict[str, Any]:
        request_id = request.get("requestId")
        if request_id:
            self.cancelled_request_ids.append(str(request_id))
        return {"ok": True}

    def is_cancelled(self, request_id: str | None) -> bool:
        if not request_id:
            return False
        return str(request_id) in self.cancelled_request_ids

    def health(self) -> dict[str, Any]:
        tts_loaded = self.kokoro.pipeline is not None
        speaker_loaded = self.speaker is not None
        return health_payload(
            "ready",
            version=__version__,
            models={
                "sttLoaded": self.stt.model is not None,
                "ttsEngine": self.active_tts_engine,
                "ttsLoaded": tts_loaded,
                "vadLoaded": self.vad.model is not None,
                "speakerLoaded": speaker_loaded,
            },
        )

    def speaker_extract(self, request: dict[str, Any]) -> dict[str, Any]:
        pcm = self._get_pcm(request)
        sample_rate = int(request.get("sampleRate", 16000))
        embedding = self.speaker.extract(pcm, sample_rate)
        return {"ok": True, "embedding": embedding}

    def speaker_identify(self, request: dict[str, Any]) -> dict[str, Any]:
        pcm = self._get_pcm(request)
        sample_rate = int(request.get("sampleRate", 16000))
        threshold = float(request.get("threshold", 0.55))
        embedding = self.speaker.extract(pcm, sample_rate)
        enrolled = []
        for p in self.speaker_store.list():
            for sample in p.get("samples") or []:
                if sample.get("embedding"):
                    enrolled.append({"id": p.get("id"), "embedding": sample.get("embedding")})
            # Backward compat: profiles that only have a top-level embedding.
            if p.get("embedding") and not p.get("samples"):
                enrolled.append({"id": p.get("id"), "embedding": p.get("embedding")})
        result = self.speaker.compare(embedding, enrolled, threshold=threshold)
        root = self.speaker_store.get_root()
        matched_profile = self.speaker_store.get(result["matchId"]) if result["matchId"] else None
        all_profiles = {p.get("id"): p for p in self.speaker_store.list()}
        matches = [
            {
                "speakerId": m["id"],
                "speakerName": all_profiles.get(m["id"], {}).get("name") if m["id"] in all_profiles else None,
                "confidence": m["confidence"],
                "isRoot": (m["id"] == root.get("id")) if (m["id"] and root) else False,
            }
            for m in result.get("matches", [])
        ]
        return {
            "ok": True,
            "speakerId": result["matchId"],
            "speakerName": matched_profile.get("name") if matched_profile else None,
            "confidence": result["confidence"],
            "recognized": result["passed"],
            "isRoot": (result["matchId"] == root.get("id")) if (result["matchId"] and root) else False,
            "rootName": root.get("name") if root else None,
            "matches": matches,
        }

    def speaker_enroll(self, request: dict[str, Any]) -> dict[str, Any]:
        name = str(request.get("name") or "").strip()
        profile_id = str(request.get("profileId") or "").strip() or None
        if not name and not profile_id:
            raise ValueError("name is required for a new profile")
        pcm = self._get_pcm(request)
        sample_rate = int(request.get("sampleRate", 16000))
        is_root = bool(request.get("isRoot"))
        if is_root:
            self.speaker_store.set_root("")  # clear first; will be set after add
        embedding = self.speaker.extract(pcm, sample_rate)
        sample_b64 = base64.b64encode(pcm).decode("ascii")

        existing_name = name
        if profile_id and not existing_name:
            existing = self.speaker_store.get(profile_id)
            existing_name = existing.get("name") if existing else name

        profile = self.speaker_store.add_sample(
            name=existing_name,
            is_root=is_root,
            embedding=embedding,
            sample_b64=sample_b64,
            sample_rate=sample_rate,
            profile_id=profile_id,
        )
        if is_root:
            self.speaker_store.set_root(profile["id"])
        return {"ok": True, "profile": profile}

    def speaker_list(self) -> dict[str, Any]:
        return {"ok": True, "profiles": self.speaker_store.list()}

    def speaker_delete(self, request: dict[str, Any]) -> dict[str, Any]:
        profile_id = str(request.get("profileId") or request.get("id") or "")
        if not profile_id:
            raise ValueError("profileId is required")
        ok = self.speaker_store.delete(profile_id)
        return {"ok": ok}

    def speaker_delete_sample(self, request: dict[str, Any]) -> dict[str, Any]:
        profile_id = str(request.get("profileId") or "")
        sample_id = str(request.get("sampleId") or "")
        if not profile_id or not sample_id:
            raise ValueError("profileId and sampleId are required")
        ok = self.speaker_store.delete_sample(profile_id, sample_id)
        return {"ok": ok}

    def speaker_set_root(self, request: dict[str, Any]) -> dict[str, Any]:
        profile_id = str(request.get("profileId") or request.get("id") or "")
        if not profile_id:
            raise ValueError("profileId is required")
        profile = self.speaker_store.set_root(profile_id)
        return {"ok": True, "profile": profile}

    def speaker_update(self, request: dict[str, Any]) -> dict[str, Any]:
        profile_id = str(request.get("profileId") or request.get("id") or "")
        if not profile_id:
            raise ValueError("profileId is required")
        name = str(request.get("name") or "").strip()
        if not name:
            raise ValueError("name is required")
        profile = self.speaker_store.update(profile_id, {"name": name})
        if not profile:
            raise ValueError(f"Profile {profile_id} not found")
        return {"ok": True, "profile": profile}

    def _get_pcm(self, request: dict[str, Any]) -> bytes:
        raw = request.get("_rawPcm")
        if isinstance(raw, (bytes, bytearray)) and raw:
            return bytes(raw)
        b64 = request.get("pcm")
        if isinstance(b64, str) and b64:
            return base64.b64decode(b64)
        raise ValueError("pcm is required")

    def warm(self, request: dict[str, Any]) -> dict[str, Any]:
        self.stt.warm(request)
        self.active_tts_engine = "kokoro"
        self.kokoro.warm(request)
        self.vad.warm(request)
        return self.health()


class VoiceRequestHandler(BaseHTTPRequestHandler):
    server_version = "AgentXVoiceSidecar/0.1"

    @property
    def runtime(self) -> VoiceRuntime:
        return self.server.runtime  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: Any) -> None:
        print(format % args, flush=True)

    def do_GET(self) -> None:
        if not self._authorized():
            self._send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
            return

        if self.path == "/health":
            self._send_json(self.runtime.health())
            return

        if self.path == "/speaker/profiles":
            self._send_json(self.runtime.speaker_list())
            return

        self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if not self._authorized():
            self._send_json({"error": "unauthorized"}, HTTPStatus.UNAUTHORIZED)
            return

        try:
            content_type = self.headers.get("content-type", "")
            parsed_url = urlparse(self.path)
            path = parsed_url.path

            # Binary STT: raw PCM body with params in query string
            if content_type == "application/octet-stream" and path in ("/stt/transcribe", "/stt/stream"):
                request = self._read_binary_stt(parsed_url)
            else:
                request = self._read_json()

            # TTS stream: NDJSON chunked response (Fix #6/#7)
            if path == "/tts/stream":
                self._handle_tts_stream(request)
                return

            response = self._handle_post(request)
            self._send_json(response)
        except NotImplementedError as error:
            self._send_json({"error": str(error), "code": "not_implemented"}, HTTPStatus.NOT_IMPLEMENTED)
        except ValueError as error:
            self._send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except Exception as error:
            self._send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def _handle_post(self, request: dict[str, Any]) -> dict[str, Any]:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/warm":
            return self.runtime.warm(request)
        if path == "/stt/transcribe":
            if request.get("pcmBase64") or request.get("pcm"):
                return self.runtime.stt.transcribe_pcm(request)
            return self.runtime.stt.transcribe(request)
        if path == "/stt/stream":
            return self.runtime.stt.stream_transcribe(request, vad=self.runtime.vad)
        if path == "/tts/synthesize":
            return self.runtime.kokoro.synthesize(request)
        if path == "/cancel":
            return self.runtime.cancel(request)
        if path == "/vad/detect":
            payload = dict(request)
            if isinstance(payload.get("pcm"), str):
                payload["pcm"] = base64.b64decode(payload["pcm"])
            return self.runtime.vad.detect(payload)
        if path == "/speaker/extract":
            return self.runtime.speaker_extract(request)
        if path == "/speaker/identify":
            return self.runtime.speaker_identify(request)
        if path == "/speaker/enroll":
            return self.runtime.speaker_enroll(request)
        if path == "/speaker/delete":
            return self.runtime.speaker_delete(request)
        if path == "/speaker/delete-sample":
            return self.runtime.speaker_delete_sample(request)
        if path == "/speaker/set-root":
            return self.runtime.speaker_set_root(request)
        if path == "/speaker/update":
            return self.runtime.speaker_update(request)
        raise ValueError("Unknown endpoint")

    def _handle_tts_stream(self, request: dict[str, Any]) -> None:
        """Stream TTS chunks as NDJSON (one JSON object per line) using chunked
        transfer encoding. The client receives each chunk immediately as it is
        synthesized, instead of waiting for all chunks to be collected."""
        cancel_check = lambda: self.runtime.is_cancelled(str(request.get("requestId") or ""))
        chunks_iter = self.runtime.kokoro.synthesize_stream(request, cancel_check=cancel_check)

        self.send_response(HTTPStatus.OK)
        self.send_header("content-type", "application/x-ndjson")
        self.send_header("transfer-encoding", "chunked")
        self.end_headers()

        try:
            for chunk in chunks_iter:
                line = json.dumps(chunk).encode("utf-8")
                self.wfile.write(f"{len(line):x}\r\n".encode("ascii"))
                self.wfile.write(line)
                self.wfile.write(b"\r\n")
                self.wfile.flush()
        except Exception as exc:
            _LOGGER.error("TTS stream failed: %s", exc, exc_info=True)
            # Headers are already sent and the body is chunked, so we can only
            # terminate the stream cleanly. The client will get zero chunks and
            # close without a misleading 30-second abort timeout.

        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

    def _read_binary_stt(self, parsed_url) -> dict[str, Any]:
        """Read raw PCM bytes from the HTTP body and construct a request dict
        from query parameters. This avoids base64 encode/decode overhead."""
        length = int(self.headers.get("content-length", "0"))
        pcm = self.rfile.read(length) if length > 0 else b""

        params = parse_qs(parsed_url.query)
        request: dict[str, Any] = {}
        if pcm:
            request["_rawPcm"] = pcm   # sidecar reads this directly (skip base64)
        if "sampleRate" in params:
            request["sampleRate"] = int(params["sampleRate"][0])
        if "modelId" in params:
            request["modelId"] = params["modelId"][0]
        if "reset" in params:
            request["reset"] = params["reset"][0].lower() in ("true", "1")
        if "finalize" in params:
            request["finalize"] = params["finalize"][0].lower() in ("true", "1")
        if "preview" in params:
            request["preview"] = params["preview"][0].lower() in ("true", "1")
        if "language" in params:
            request["language"] = params["language"][0]
        return request

    def _authorized(self) -> bool:
        token = self.runtime.config.auth_token
        header = self.headers.get("authorization", "")
        return bool(token) and header == f"Bearer {token}"

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("content-length", "0"))
        if length == 0:
            return {}
        body = self.rfile.read(length)
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("Expected JSON object")
        return payload

    def _send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class VoiceSidecarServer(ThreadingHTTPServer):
    def __init__(self, config: SidecarConfig) -> None:
        if config.host != "127.0.0.1":
            raise ValueError("Voice sidecar must bind to 127.0.0.1")
        super().__init__((config.host, config.port), VoiceRequestHandler)
        self.runtime = VoiceRuntime(config)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Agent-X local voice sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = SidecarConfig(
        host=args.host,
        port=args.port,
        auth_token=os.environ.get("AGENTX_VOICE_AUTH_TOKEN", ""),
        data_dir=os.environ.get("AGENTX_VOICE_DATA_DIR", ""),
    )
    server = VoiceSidecarServer(config)
    print(f"Agent-X voice sidecar ready on {config.host}:{config.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
