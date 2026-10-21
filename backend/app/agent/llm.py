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


class OpenAICompatLLM:
    def __init__(self, **over):
        self.s = {**llm_settings(), **over}

    @property
    def configured(self) -> bool:
        return bool(self.s["api_key"])

    async def stream(self, messages: list[dict], tools: list[dict] | None = None) -> AsyncIterator[tuple[str, object]]:
        """Yields ('text', delta) and finally ('tool_calls', [{id,name,arguments(str)}]) when the model calls tools."""
        if not self.configured:
            raise LLMUnavailable("no API key configured")
        effort = self.s.get("reasoning_effort") or ("none" if self.s["model"] in _NEEDS_EFFORT_NONE else None)
        for _ in range(3):  # each provider quirk costs at most one cheap failed request, then it is remembered
            try:
                async for ev in self._once(messages, tools, effort):
                    yield ev
                return
            except _EffortRequired:
                _NEEDS_EFFORT_NONE.add(self.s["model"])
                effort = "none"
            except _TemperatureRejected:
                _NO_TEMPERATURE.add(self.s["model"])

    async def _once(self, messages, tools, effort):
        body = {"model": self.s["model"], "messages": messages, "stream": True}
        if effort:
            body["reasoning_effort"] = effort
        elif self.s["model"] not in _NO_TEMPERATURE:
            body["temperature"] = 0.3
        if tools:
            body["tools"] = tools
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
                        raise LLMUnavailable(f"LLM HTTP {r.status_code}: {err[:200]}")
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            ch = json.loads(data)["choices"][0]["delta"]
                        except (KeyError, IndexError, json.JSONDecodeError):
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
