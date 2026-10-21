"""Tiny .env loader (no extra dependency). Real environment variables win over the file."""
import os
from pathlib import Path


def load_env():
    f = Path(__file__).resolve().parents[1] / ".env"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()


def llm_settings() -> dict:
    return {
        "api_key": os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or "",
        "base_url": (os.environ.get("LLM_BASE_URL") or "https://api.openai.com/v1").rstrip("/"),
        "model": os.environ.get("LLM_MODEL") or "gpt-4o-mini",
        "timeout": float(os.environ.get("LLM_TIMEOUT_S", "40")),
        # Reasoning models (e.g. gpt-6-*) reject function tools unless this is "none". Unset = don't send it;
        # llm.py also retries once with "none" if the provider asks for it.
        "reasoning_effort": os.environ.get("LLM_REASONING_EFFORT") or None,
    }
