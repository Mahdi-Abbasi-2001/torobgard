"""Persian text normalization shared by ingest and query paths."""
import re

_AR_TO_FA = str.maketrans({"ي": "ی", "ك": "ک", "ۀ": "ه", "ة": "ه", "أ": "ا", "إ": "ا", "ؤ": "و"})
_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
_WS = re.compile(r"\s+")
_DIACRITICS = re.compile(r"[ً-ٰٟـ]")


def normalize_fa(text: str | None) -> str:
    """Unify Arabic/Persian letter forms, digits, ZWNJ, diacritics and whitespace; lowercase latin."""
    if not text:
        return ""
    t = text.translate(_AR_TO_FA).translate(_DIGITS)
    t = _DIACRITICS.sub("", t).replace("‌", " ").replace("‏", "").replace("‎", "")
    return _WS.sub(" ", t).strip().lower()


def to_persian_digits(s: str) -> str:
    return s.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


_MULT = {"میلیون": 1_000_000, "ملیون": 1_000_000, "تومن": 1, "تومان": 1, "هزار": 1_000, "میلیارد": 1_000_000_000}


def split_budget(text: str) -> tuple[dict, str]:
    """Return (budget, text-with-budget-phrase-removed) so the phrase isn't searched as product words."""
    t = normalize_fa(text)
    out = parse_budget(t)
    if not out:
        return out, t
    num = r"\d+(?:[.,/]\d+)?"
    unit = r"\s*(?:میلیارد|میلیون|ملیون|هزار|تومان|تومن)?"
    pat = rf"(?:بین\s*{num}{unit}\s*(?:تا|و)\s*{num}{unit}|(?:زیر|کمتر از|تا|حداکثر|حدود|بالای|بیشتر از|حداقل)\s*{num}{unit})"
    return out, re.sub(r"\s+", " ", re.sub(pat, " ", t)).strip()


def parse_budget(text: str) -> dict:
    """Extract {min,max} in toman from phrases like 'زیر ۱۵ میلیون', 'بین ۲ تا ۳ میلیون', '۲.۵ تومن'.

    'تومن' alone after a small number (<1000) means million in colloquial Persian ('۱۵ تومن').
    """
    t = normalize_fa(text)
    out: dict = {}
    num = r"(\d+(?:[.,/]\d+)?)"
    unit = r"\s*(میلیارد|میلیون|ملیون|هزار|تومان|تومن)?"

    def val(n: str, u: str | None) -> int:
        x = float(n.replace(",", ".").replace("/", "."))
        if u in ("تومن", "تومان", None):
            if x < 1000:
                x *= 1_000_000 if u else 1
            return int(x)
        return int(x * _MULT[u])

    m = re.search(rf"بین\s*{num}{unit}\s*(?:تا|و)\s*{num}{unit}", t)
    if m:
        u1 = m.group(2) or m.group(4)
        out["min"], out["max"] = val(m.group(1), u1), val(m.group(3), m.group(4) or u1)
        return out
    m = re.search(rf"(?:زیر|کمتر از|تا|حداکثر|حدود)\s*{num}{unit}", t)
    if m:
        out["max"] = val(m.group(1), m.group(2))
    m = re.search(rf"(?:بالای|بیشتر از|حداقل)\s*{num}{unit}", t)
    if m:
        out["min"] = val(m.group(1), m.group(2))
    return out


# ---- a need that names a gender hides what is clearly made for the other one (neutral titles stay: they are unknown, not wrong)
_FEMALE = re.compile(r"دختر|زنانه|بانوان|مانتو|سرافون|مقنعه|روسری|شومیز|دامن|ساپورت")
_MALE = re.compile(r"پسر|مردانه|آقایان")


def need_gender(need: str | None) -> str | None:
    n = normalize_fa(need)
    if _MALE.search(n):
        return "m"
    if _FEMALE.search(n):
        return "f"
    return None


def fits_need(title: str | None, need: str | None) -> bool:
    g = need_gender(need)
    t = normalize_fa(title)
    if g == "m":
        return not _FEMALE.search(t)
    if g == "f":
        return not _MALE.search(t)
    return True
