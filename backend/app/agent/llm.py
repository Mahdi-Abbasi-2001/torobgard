"""Provider-agnostic streaming client for any OpenAI-compatible /chat/completions endpoint (OpenAI, BoxAPI, ...)."""
from __future__ import annotations
import json
from typing import AsyncIterator

import httpx

from ..config import llm_settings


class LLMUnavailable(Exception):
    pass


_NEEDS_EFFORT_NONE: set[str] = set()  # models that told us to use reasoning_effort="none" (remembered per process)
_NO_TEMPERATURE: set[str] = set()     # reasoning models that reject a custom temperature
_NO_USAGE: set[str] = set()           # providers that reject stream_options (usage then isn't counted)

# Process-wide token counters, exposed by /api/chat-status so cost can be watched live.
USAGE = {"calls": 0, "prompt_tokens": 0, "cached_tokens": 0, "completion_tokens": 0}


class OpenAICompatLLM:
    def __init__(self, **over):
        self.s = {**llm_settings(), **over}

    @property
    def configured(self) -> bool:
        return bool(self.s["api_key"])

    async def stream(self, messages: list[dict], tools: list[dict] | None = None, json_mode: bool = False) -> AsyncIterator[tuple[str, object]]:
        """Yields ('text', delta) and finally ('tool_calls', [{id,name,arguments(str)}]) when the model calls tools."""
        if not self.configured:
            raise LLMUnavailable("no API key configured")
        effort = self.s.get("reasoning_effort") or ("none" if self.s["model"] in _NEEDS_EFFORT_NONE else None)
        for _ in range(3):  # each provider quirk costs at most one cheap failed request, then it is remembered
            try:
                async for ev in self._once(messages, tools, effort, json_mode):
                    yield ev
                return
            except _EffortRequired:
                _NEEDS_EFFORT_NONE.add(self.s["model"])
                effort = "none"
            except _TemperatureRejected:
                _NO_TEMPERATURE.add(self.s["model"])
            except _UsageRejected:
                _NO_USAGE.add(self.s["model"])

    async def complete_json(self, messages: list[dict]) -> dict:
        """One JSON-mode call, returned parsed. Raises LLMUnavailable / ValueError."""
        out = ""
        async for kind, val in self.stream(messages, None, json_mode=True):
            if kind == "text":
                out += val
        obj = json.loads(out)
        if not isinstance(obj, dict):
            raise ValueError("expected a JSON object")
        return obj

    async def transcribe(self, audio: bytes, filename: str = "voice.ogg") -> str:
        """Speech to text through the provider's /audio/transcriptions (Whisper-compatible)."""
        if not self.configured:
            raise LLMUnavailable("no API key configured")
        import os
        model = os.environ.get("LLM_STT_MODEL") or "whisper-1"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10)) as c:
                r = await c.post(f"{self.s['base_url']}/audio/transcriptions",
                                 headers={"Authorization": f"Bearer {self.s['api_key']}"},
                                 data={"model": model, "language": "fa"}, files={"file": (filename, audio)})
        except httpx.HTTPError as e:
            raise LLMUnavailable(f"STT network error: {e}") from e
        if r.status_code != 200:
            raise LLMUnavailable(f"STT HTTP {r.status_code}: {r.text[:200]}")
        return (r.json().get("text") or "").strip()

    async def _once(self, messages, tools, effort, json_mode=False):
        body = {"model": self.s["model"], "messages": messages, "stream": True}
        if effort:
            body["reasoning_effort"] = effort
        elif self.s["model"] not in _NO_TEMPERATURE:
            body["temperature"] = 0.3
        if tools:
            body["tools"] = tools
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        if self.s["model"] not in _NO_USAGE:
            body["stream_options"] = {"include_usage": True}
        calls: dict[int, dict] = {}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.s["timeout"], connect=10)) as c:
                async with c.stream("POST", f"{self.s['base_url']}/chat/completions", json=body,
                                    headers={"Authorization": f"Bearer {self.s['api_key']}"}) as r:
                    if r.status_code != 200:
                        err = (await r.aread())[:600].decode("utf-8", "replace")
                        if r.status_code == 400 and "reasoning_effort" in err and not effort:
                            raise _EffortRequired()
                        if r.status_code == 400 and "temperature" in err and "temperature" in body:
                            raise _TemperatureRejected()
                        if r.status_code == 400 and "stream_options" in err and "stream_options" in body:
                            raise _UsageRejected()
                        raise LLMUnavailable(f"LLM HTTP {r.status_code}: {err[:200]}")
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        u = obj.get("usage")
                        if u:  # final chunk when include_usage is on
                            USAGE["calls"] += 1
                            USAGE["prompt_tokens"] += u.get("prompt_tokens", 0)
                            USAGE["completion_tokens"] += u.get("completion_tokens", 0)
                            USAGE["cached_tokens"] += (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
                        try:
                            ch = obj["choices"][0]["delta"]
                        except (KeyError, IndexError):
                            continue
                        if ch.get("content"):
                            yield "text", ch["content"]
                        for tc in ch.get("tool_calls") or []:
                            slot = calls.setdefault(tc["index"], {"id": "", "name": "", "arguments": ""})
                            slot["id"] = tc.get("id") or slot["id"]
                            fn = tc.get("function") or {}
                            slot["name"] += fn.get("name") or ""
                            slot["arguments"] += fn.get("arguments") or ""
        except httpx.HTTPError as e:
            raise LLMUnavailable(f"LLM network error: {e}") from e
        if calls:
            yield "tool_calls", [calls[i] for i in sorted(calls)]


class _EffortRequired(Exception):
    pass


class _TemperatureRejected(Exception):
    pass


class _UsageRejected(Exception):
    pass
