"""Extract mall / floor / unit from free-text Tehran bazaar addresses."""
import re
from dataclasses import dataclass, asdict

from .text import normalize_fa

_FLOOR_WORDS = {
    "همکف": 0, "اول": 1, "دوم": 2, "سوم": 3, "چهارم": 4, "پنجم": 5, "ششم": 6,
    "هفتم": 7, "هشتم": 8, "نهم": 9, "دهم": 10, "زیرزمین": -1,
}
_MALL_KW = r"(?:پاساژ|مجتمع تجاری|مجتمع|مرکز خرید|مرکز تجارت جهانی|ساختمان|برج|بازار|پلازا|مارکت|مرکز)"
_STOP = r"(?=\s*(?:،|,|-|طبقه|پلاک|واحد|غرفه|همکف|زیرزمین|زنگ|\(|$))"
_MALL_RE = re.compile(rf"(?<![\w])({_MALL_KW}\s+[^،,\n]+?){_STOP}")
_FLOOR_NUM = re.compile(r"طبقه\s*(?:ی\s*)?(منفی\s*[^\s،,]+|-?\d+|[^\s،,]+)")
_UNIT_RE = re.compile(r"(?:واحد|غرفه)\s*([A-Za-z]?\s*\d+[A-Za-z]?(?:/\d+)?)")
_PLAQUE_RE = re.compile(r"پلاک\s*([\d/]+(?:\s*و\s*\d+)?)")


@dataclass
class ParsedAddress:
    mall: str | None
    floor: int | None
    floor_label: str | None
    unit: str | None
    plaque: str | None
    street: str | None

    def asdict(self):
        return asdict(self)


def _parse_floor(text: str) -> tuple[int | None, str | None]:
    if re.search(r"\bهمکف\b", text) and "بالای همکف" not in text:
        return 0, "همکف"
    if "بالای همکف" in text:
        return 1, "بالای همکف"
    m = _FLOOR_NUM.search(text)
    if m:
        raw = m.group(1).strip()
        if raw.startswith("منفی"):
            n = raw.replace("منفی", "").strip()
            digits = {"یک": 1, "دو": 2, "سه": 3}.get(n) or (int(n) if n.isdigit() else 1)
            return -digits, f"منفی {digits}"
        if re.fullmatch(r"-?\d+", raw):
            return int(raw), raw
        if raw in _FLOOR_WORDS:
            return _FLOOR_WORDS[raw], raw
        return None, raw
    if "زیرزمین" in text:
        return -1, "زیرزمین"
    return None, None


def parse_address(address: str | None) -> ParsedAddress:
    t = normalize_fa(address or "")
    if not t:
        return ParsedAddress(None, None, None, None, None, None)
    mall = None
    m = _MALL_RE.search(t)
    if m:
        mall = m.group(1).strip()
        # drop trailing generic nouns that are not part of the name
        mall = re.sub(r"\s+(?:روبروی|نبش|جنب|بعد از|نرسیده به).*$", "", mall)
        if mall in ("پاساژ", "مجتمع", "ساختمان", "برج", "بازار", "مرکز"):
            mall = None
    floor, floor_label = _parse_floor(t)
    u = _UNIT_RE.search(t)
    p = _PLAQUE_RE.search(t)
    street = t.split("،")[0].strip() if "،" in t else None
    return ParsedAddress(mall, floor, floor_label, u.group(1).replace(" ", "").upper() if u else None,
                         p.group(1) if p else None, street)


def floor_display(floor: int | None, label: str | None) -> str | None:
    if floor is None:
        return label
    if floor == 0:
        return "همکف"
    if floor < 0:
        return f"طبقه منفی {abs(floor)}"
    return f"طبقه {floor}"


def mall_key(mall: str | None) -> str | None:
    """Canonical key so spelling variants of one mall group together (علاالدین/علاءالدین 2 -> one key)."""
    if not mall:
        return None
    k = re.sub(r"^(?:پاساژ|مجتمع تجاری|مجتمع|مرکز خرید|ساختمان|برج|بازار)\s+", "", mall)
    k = k.replace("ء", "").replace("ئ", "ی").replace("آ", "ا")
    k = re.sub(r"ا{2,}", "ا", k)
    return re.sub(r"\s+", " ", k).strip() or None
