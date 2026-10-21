"""Opening-hours interpretation. Tehran time; week starts Saturday; Friday is mostly closed."""
from __future__ import annotations
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

TEHRAN = timezone(timedelta(hours=3, minutes=30))  # IRST (DST abolished in 2022)
# Python weekday(): Mon=0 ... Sun=6
_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_FA = {"sat": "شنبه", "sun": "یکشنبه", "mon": "دوشنبه", "tue": "سه‌شنبه", "wed": "چهارشنبه", "thu": "پنجشنبه", "fri": "جمعه"}


def now_tehran() -> datetime:
    return datetime.now(TEHRAN)


@dataclass
class OpenState:
    state: str  # open | closing_soon | closed | unknown
    label: str  # Persian human label
    closes_at: str | None = None
    opens_at: str | None = None
    quality: str = "ok"  # ok | missing | suspicious


def _mins(t: str) -> int:
    h, m = t.split(":")[:2]
    return int(h) * 60 + int(m)


def _shifts(day: dict) -> list[tuple[int, int]]:
    out = []
    for s in day.get("shifts") or []:
        a, b = _mins(s["start_time"]), _mins(s["end_time"])
        out.append((a, b))
    return out


def day_hours(hours: dict | None, day: str) -> tuple[str, list[tuple[int, int]]]:
    """Return (status, shifts) for a day. status: declared | closed | unsupported | missing."""
    if not hours or day not in hours:
        return "missing", []
    d = hours[day]
    st = d.get("status", "missing")
    if st != "declared":
        return st, []
    sh = [(a, b) for a, b in _shifts(d) if not (a == b)]
    # shifts like 00:00-00:00 or ending before start (overnight) are suspicious
    return ("declared" if sh else "unsupported"), sh


def hours_quality(hours: dict | None) -> str:
    if not hours:
        return "missing"
    sus = False
    declared = 0
    for day in _DAYS:
        st, sh = day_hours(hours, day)
        if st == "declared":
            declared += 1
            for a, b in sh:
                if b <= a or (b - a) < 120 or a < 5 * 60:
                    sus = True
    if declared == 0:
        return "missing"
    return "suspicious" if sus else "ok"


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def open_state(hours: dict | None, at: datetime | None = None) -> OpenState:
    at = at or now_tehran()
    q = hours_quality(hours)
    if q == "missing":
        return OpenState("unknown", "ساعت کاری ثبت نشده", quality=q)
    day = _DAYS[at.weekday()]
    st, shifts = day_hours(hours, day)
    cur = at.hour * 60 + at.minute
    if st == "declared":
        for a, b in shifts:
            if a <= cur < b:
                left = b - cur
                if left <= 60:
                    return OpenState("closing_soon", f"باز است · {left} دقیقه تا بسته شدن ({_fmt(b)})", closes_at=_fmt(b), quality=q)
                return OpenState("open", f"باز است · تا {_fmt(b)}", closes_at=_fmt(b), quality=q)
        later = [a for a, _ in shifts if a > cur]
        if later:
            return OpenState("closed", f"بسته است · امروز {_fmt(min(later))} باز می‌شود", opens_at=_fmt(min(later)), quality=q)
    elif st == "unsupported":
        return OpenState("unknown", "ساعت کاری این روز نامشخص است", quality=q)
    # find next open day
    for i in range(1, 8):
        nd = _DAYS[(at.weekday() + i) % 7]
        nst, nsh = day_hours(hours, nd)
        if nst == "declared" and nsh:
            when = "فردا" if i == 1 else DAY_FA[nd]
            return OpenState("closed", f"بسته است · {when} {_fmt(nsh[0][0])}", opens_at=f"{when} {_fmt(nsh[0][0])}", quality=q)
    return OpenState("closed", "بسته است", quality=q)


def parse_hours_json(raw: str | None) -> dict | None:
    if not raw or raw == "null":
        return None
    try:
        h = json.loads(raw)
    except Exception:
        return None
    return h or None
