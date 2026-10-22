"""Turn the shopper's one sentence into a mission's slots: what, need, budget, where, when, how, conditions.

Rule-based on purpose: instant, deterministic, and it keeps working when the LLM is down. Anything it cannot read stays
null and the app shows that slot as «open» for the shopper to fill in (never guessed)."""
import re
from datetime import datetime

from . import catalog, discover
from .text import normalize_fa, split_budget

_NEED_LEAD = re.compile(r"\s(?:برای|جهت|مناسب|مخصوص|واسه|واسهٔ|برا)\s+")
_INSTALL = re.compile(r"\bقسط(?:ی)?\b|اقساط")
_OPEN = re.compile(r"\bباز(?: باشه| باشد)?\b")
_WALK = re.compile(r"(?:\bبا )?\bپیاده\b")
_TAXI = re.compile(r"(?:\bبا )?\b(?:تاکسی|اسنپ|تپسی|آژانس)\b")
_CAR = re.compile(r"(?:\bبا )?\b(?:ماشین|خودرو|سواری)\b")
_NOW = re.compile(r"\b(?:همین الان|الان|فوری|الآن)\b")
_HOUR_LATER = re.compile(r"(?:یک|1)\s*ساعت\s*(?:دیگه|دیگر|بعد)|ساعت دیگه")
_EVENING = re.compile(r"\b(?:عصر|بعد ?از ?ظهر|بعدازظهر)\b")
_NIGHT = re.compile(r"\b(?:شب|امشب)\b")
_MORNING = re.compile(r"\b(?:صبح)\b")
_TOMORROW = re.compile(r"\bفردا\b")
_CLOCK = re.compile(r"(?:ساعت\s*)?(\d{1,2})(?::(\d{2}))?(?=\s|$)")


def _fa_digits(s: str) -> str:
    return s.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


def _strip(text: str, pat: re.Pattern | str) -> str:
    return re.sub(r"\s+", " ", re.sub(pat, " ", text)).strip()


def _slot_when(t: str) -> tuple[str | None, str]:
    """Return (when, text with the time phrase removed). when: now | 1h | evening | tomorrow | HH:MM."""
    if _HOUR_LATER.search(t):
        return "1h", _strip(t, _HOUR_LATER)
    m = re.search(r"ساعت\s*(\d{1,2})(?::(\d{2}))?", t)
    if m:
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        if h <= 11 and (_EVENING.search(t) or _NIGHT.search(t)):
            h += 12
        elif h <= 7 and not _MORNING.search(t):
            h += 12  # «ساعت ۶» in a shopping context means 6 pm
        if h < 24 and mi < 60:
            rest = _strip(t, r"(?:فردا\s*)?(?:عصر|شب|صبح)?\s*ساعت\s*\d{1,2}(?::\d{2})?")
            return f"{h:02d}:{mi:02d}", rest
    if _TOMORROW.search(t):
        return "tomorrow", _strip(t, _TOMORROW)
    if _EVENING.search(t):
        return "evening", _strip(t, _EVENING)
    if _NIGHT.search(t):
        return "20:00", _strip(t, _NIGHT)
    if _NOW.search(t):
        return "now", _strip(t, _NOW)
    return None, t


def _slot_mode(t: str) -> tuple[str | None, str]:
    if _TAXI.search(t):
        return "taxi", _strip(t, _TAXI)
    if _CAR.search(t):
        return "car", _strip(t, _CAR)
    if _WALK.search(t):
        return "walk", _strip(t, _WALK)
    return None, t


def _slot_place(con, t: str) -> tuple[dict | None, str]:
    """A named mall or area the dataset really has («نزدیک علاالدین», «اطراف فردوسی»). Longest name wins."""
    cands: list[tuple[str, dict]] = []
    for m in catalog.list_malls(con, 40):
        name = re.sub(r"^(?:پاساژ|مجتمع|ساختمان|مرکز)\s+", "", normalize_fa(m["mall"]))
        name = re.sub(r"\s*\d+$", "", name)
        if len(name) >= 3:
            cands.append((name, {"kind": "mall", "label": m["mall"], "mall_key": m["mall_key"], "area": m["area"]}))
    for a in discover.areas(con):
        cands.append((normalize_fa(a["label"]), {"kind": "area", "label": a["label"], "lat": a["lat"], "lon": a["lon"]}))
    alias = {"علاءالدین": "علاالدین", "علاالدین": "علاالدین", "علالدین": "علاالدین"}
    t2 = t
    for k, v in alias.items():
        t2 = t2.replace(k, v)
    best = None
    for name, info in sorted(cands, key=lambda c: -len(c[0])):
        nm = alias.get(name, name)
        if re.search(rf"(?<!\S){re.escape(nm)}(?!\S)", t2):
            best = (nm, info)
            break
    if not best:
        return None, t
    nm, info = best
    if info["kind"] == "mall":
        row = con.execute("SELECT AVG(lat), AVG(lon) FROM shops WHERE mall_key = ? AND lat IS NOT NULL", (info["mall_key"],)).fetchone()
        if row and row[0]:
            info = {**info, "lat": round(row[0], 5), "lon": round(row[1], 5)}
    rest = _strip(t2, rf"(?:(?:نزدیک|اطراف|دور و بر|حوالی|توی|تو|در|پاساژ|منطقه|محدودهٔ|محدوده)\s+)*(?:پاساژ\s+)?{re.escape(nm)}")
    return info, rest


def parse(con, text: str) -> dict:
    """Read a mission sentence. Every slot is present in the result; unread ones are null."""
    raw = text or ""
    cleaned = raw.replace("٫", ".").replace("٬", "")  # Persian decimal / thousands marks
    # «۱۰ تا ۱۵ میلیون» (a range without «بین»)
    cleaned = re.sub(r"(?<![\d.])(\d+(?:\.\d+)?)\s*تا\s*(\d+(?:\.\d+)?)\s*(میلیون|ملیون|هزار|تومان|تومن)",
                     lambda m: f"بین {m.group(1)} تا {m.group(2)} {m.group(3)}", normalize_fa(cleaned))
    budget, t = split_budget(cleaned)  # normalised, budget phrase removed
    t = re.sub(r"[،,;؛؟?!]+", " ", re.sub(r"(?<=\D)\.(?=\s|$)", " ", t))
    t = re.sub(r"\s+", " ", t).strip()
    understood: list[str] = []

    when, t = _slot_when(t)
    mode, t = _slot_mode(t)
    place, t = _slot_place(con, t)
    inst = bool(_INSTALL.search(t))
    if inst:
        t = _strip(t, _INSTALL)
    open_only = bool(re.search(r"\bباز(?: باشه| باشد)\b", t))
    if open_only:
        t = _strip(t, r"\bباز(?: باشه| باشد)\b")

    # product words before «برای», the need after it
    need = None
    m = _NEED_LEAD.search(" " + t + " ")
    prod = t
    if m:
        s = " " + t + " "
        prod = s[:m.start()].strip()
        need = s[m.end():].strip() or None
    prod = _strip(prod, r"\b(?:یه|یک|می ?خوام|میخوام|دنبال|نیاز دارم|لازم دارم|بخرم|یکی)\b")
    prod = re.sub(r"[،,.؟?!]+", " ", prod).strip()
    if need:
        need = re.sub(r"[،,.؟?!]+", " ", need).strip()

    category = None
    if prod:
        try:
            hit = catalog.search_products(con, prod, None, None, budget.get("min"), budget.get("max"), True, 1, 0)
            if hit["items"]:
                category = hit["items"][0].get("category")
        except Exception:
            category = None

    if prod:
        understood.append("product")
    if need:
        understood.append("need")
    if budget:
        understood.append("budget")
    if place:
        understood.append("place")
    if when:
        understood.append("when")
    if mode:
        understood.append("mode")
    if inst:
        understood.append("installment")
    return {
        "text": raw.strip(),
        "query": prod or None,
        "need": need,
        "category": category,
        "budget": {"min": budget.get("min"), "max": budget.get("max")} if budget else None,
        "place": place,
        "when": when,
        "mode": mode,
        "conditions": {"installment": inst, "open": open_only},
        "understood": understood,
    }
