"""The agent's voice on the in-app call: Persian text to speech with Piper, running inside the server (no key, no network, works in Iran).
Voice: fa_IR-amir-medium (data licence CC0). The model loads on first use (about 3 s) and stays in memory."""
from __future__ import annotations

import io
import os
import threading
import wave
from pathlib import Path

VOICE_PATH = Path(os.environ.get("TOROB_VOICE", Path(__file__).resolve().parents[2] / "voices" / "fa_IR-amir-medium.onnx"))
_voice = None
_lock = threading.Lock()


def available() -> bool:
    if not VOICE_PATH.exists():
        return False
    try:
        import piper  # noqa: F401
        return True
    except ImportError:
        return False


def synth_wav(text: str) -> bytes:
    """Blocking: call from a worker thread. Returns a WAV file."""
    global _voice
    with _lock:
        if _voice is None:
            from piper import PiperVoice
            _voice = PiperVoice.load(str(VOICE_PATH))
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            _voice.synthesize_wav(text, w)
    return buf.getvalue()
