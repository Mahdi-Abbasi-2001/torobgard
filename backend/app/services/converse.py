"""Talking to sellers like a person would.

- compose(): the message a seller receives (ask / hold / recheck).
- parse_reply(): turns a seller's free text («دارم ولی آبیش تموم شده، ۲۸۵۰ میشه») into fields. Uses the LLM when one is
  configured and always falls back to rules, so it works offline and for every simulated seller text.
- follow_up(): decides whether the agent must ask again (no price, unclear stock, hold not answered ...).
- suggest_questions(): product-aware questions (storage, size, original vs copy ...) from the product's specs.
"""
from __future__ import annotations
import json
import re
from datetime import datetime, timezone

from .text import normalize_fa, to_persian_digits


def fa(s) -> str:
    return to_persian_digits(str(s))

MAX_FOLLOW_UPS = 2


def money(n: int) -> str:
    return fa(f"{int(n):,}").replace(",", "٬")


# ---------------------------------------------------------------- composing
def compose(kind: str, title: str | None, questions: list[str], note: str | None = None, meta: dict | None = None) -> str:
    meta = meta or {}
    t = f"«{title}»" if title else "کالای موردنظر"
    if kind == "hold":
        return (f"سلام، وقت بخیر. همان مشتری {t} است. لطفاً تا ساعت {fa(meta.get('hold_until') or '')} یکی برایش کنار بگذارید؛ "
                "خودش می‌آید و حضوری می‌خرد. امکانش هست؟")
    if kind == "arrive":
        code = f" کد نگه‌داری: {fa(meta['hold_code'])}." if meta.get("hold_code") else ""
        return f"سلام. مشتری {t} الان رسیده و دم فروشگاه است.{code} لطفاً آمادهٔ تحویل باشید."
    if kind == "bargain":
        was = f" (قیمتی که گفتید {money(meta['price'])} تومان بود)" if meta.get("price") else ""
        return (f"سلام دوباره. مشتری {t} می‌خواهد همین الان بیاید و حضوری بخرد؛ اگر {money(meta.get('target') or 0)} تومان بدهد، می‌فروشید؟{was} "
                "اگر نه، پایین‌ترین قیمتتان برای او چقدر است؟")
    if kind == "recheck":
        eta = meta.get("eta_min")
        p = meta.get("price")
        at = f" به همان قیمت {money(p)} تومان" if p else ""
        return f"سلام دوباره. مشتری {t} الان راه افتاده{f' و حدود {fa(eta)} دقیقهٔ دیگر می‌رسد' if eta else ''}. هنوز موجود است{at}؟"
    lines = [f"سلام، وقت بخیر. مشتری‌ای از ترب‌گرد دربارهٔ {t} می‌پرسد:"]
    lines += [f"• {q}" for q in questions]
    if note:
        lines.append(f"یادداشت مشتری: «{note}»")
    return "\n".join(lines)


# ---------------------------------------------------------------- prices / times
_NUM = r"\d{1,3}(?:[,٬]\d{3})+|\d+(?:[.٫/]\d+)?"
_NOT_PRICE_AFTER = r"\s*(?:شب|صبح|عصر|ظهر|بعد ?از ?ظهر|ماه|روز|دقیقه|سال|ساعت|عدد|تا\b|نفر|گیگ|ترابایت|اینچ|درصد|٪|%|رنگ|سایز|:)"


def _num(s: str) -> float:
    return float(s.replace(",", "").replace("٬", "").replace("٫", ".").replace("/", "."))


def normalize_price(v: float | int | None, listed: int | None = None, unit: str | None = None) -> int | None:
    """Sellers say «۲۸۵۰» for 2,850,000 and «۲.۸ تومن» for 2.8 million. With the listed price as a reference pick the
    reading that fits; without one, small bare numbers are thousands."""
    if not v or v <= 0:
        return None
    if unit in ("میلیون", "ملیون"):
        v *= 1_000_000
    elif unit == "هزار":
        v *= 1_000
    elif unit == "میلیارد":
        v *= 1_000_000_000
    elif unit == "ریال":
        v /= 10
    elif listed:
        for m in (1, 1_000, 1_000_000, 0.1):
            if 0.4 * listed <= v * m <= 2.5 * listed:
                v *= m
                break
        else:
            if unit in ("تومن", "تومان") and v < 1000:
                v *= 1_000_000
            elif v < 100_000:
                v *= 1_000
    elif unit in ("تومن", "تومان") and v < 1000:
        v *= 1_000_000
    elif v < 100_000:
        v *= 1_000
    v = int(round(v))
    return v if 1_000 <= v <= 2_000_000_000 else None


def extract_price(text: str, listed: int | None = None) -> int | None:
    t = normalize_fa(text)
    m = re.search(rf"({_NUM})\s*(?:میلیون|ملیون)\s*و\s*({_NUM})\s*(هزار)?", t)
    if m:  # «۲ میلیون و ۸۵۰»
        b = _num(m.group(2))
        return normalize_price(_num(m.group(1)) * 1_000_000 + (b * 1000 if b < 1000 else b), None, "تومان")
    for m in re.finditer(rf"({_NUM})\s*(میلیارد|میلیون|ملیون|هزار|تومن|تومان|ریال)?", t):
        before, after = t[max(0, m.start() - 8):m.start()], t[m.end():m.end() + 14]
        unit = m.group(2)
        if not unit and (re.search(r"(?:ساعت|تا)\s*$", before) or re.match(_NOT_PRICE_AFTER, after)):
            continue
        if not unit and re.match(r"\s*(?:ماه|روز)", after):
            continue
        p = normalize_price(_num(m.group(1)), listed, unit)
        if p:
            return p
    return None


def _hour(h: int, mnt: int, qual: str | None) -> str | None:
    if qual in ("شب", "عصر", "بعدازظهر", "بعد از ظهر") and h < 12:
        h += 12
    elif qual is None and 1 <= h <= 7:
        h += 12  # «تا ۸» in a shop context means 20:00
    return f"{h:02d}:{mnt:02d}" if 0 <= h <= 23 and 0 <= mnt < 60 else None


def extract_closes_at(text: str) -> str | None:
    t = normalize_fa(text)
    m = (re.search(r"تا\s*(?:ساعت\s*)?(\d{1,2})(?:[:٫.](\d{2}))?\s*(شب|عصر|بعد ?از ?ظهر|صبح)?", t)
         or re.search(r"ساعت\s*(\d{1,2})(?:[:٫.](\d{2}))?\s*(شب|عصر|صبح)?\s*(?:می ?بندیم|تعطیل)", t))
    if not m:
        return None
    return _hour(int(m.group(1)), int(m.group(2) or 0), m.group(3))


def extract_opens_at(text: str) -> str | None:
    t = normalize_fa(text)
    m = re.search(r"(?:از\s*)?ساعت\s*(\d{1,2})(?:[:٫.](\d{2}))?\s*(صبح|ظهر)?\s*(?:باز|میایم|می ?آییم|هستیم)", t)
    return _hour(int(m.group(1)), int(m.group(2) or 0), m.group(3) or "صبح") if m else None


# ---------------------------------------------------------------- rule parser
_NEG = [r"موجود\s*نیست", r"موجود\s*نداریم", r"ندار(?:یم|م|ه)(?:ش)?", r"تموم\s*(?:شده|کردیم|کرده|شد)?", r"تمام\s*(?:شده|کردیم|شد)",
        r"ناموجود", r"فروخته\s*شد", r"فروش\s*رفت", r"\bنه\b", r"نخیر", r"متاسفانه", r"شرمنده"]
_POS = [r"داریم", r"\bدارم\b", r"موجود", r"\bهست\b", r"هستش", r"\bبله\b", r"\bآره\b", r"\bاره\b", r"تشریف", r"بیای(?:ن|د)",
        r"\bبفرمایید\b", r"\bچشم\b"]
_HOLD_YES = [r"کنار\s*می\s*ذار", r"کنار\s*میذار", r"کنار\s*می\s*گذار", r"نگه\s*می\s*دار", r"نگه\s*میدار", r"نگهش\s*می\s*دار",
             r"\bباشه\b", r"\bحتما\b", r"\bچشم\b", r"مشکلی\s*نیست", r"\bبله\b", r"\bآره\b", r"\bاره\b", r"اوکی"]
_HOLD_NO = [r"نگه\s*نمی", r"نمی\s*تونم", r"نمیتونم", r"نمی\s*شه", r"نمیشه", r"\bنه\b", r"شرمنده", r"امکانش\s*نیست", r"نمیتونیم",
            r"نمی\s*تونیم"]
_STOP = {"ولی", "اما", "فقط", "و", "رو", "را", "هم", "الان", "هنوز", "نه", "بله", "آره", "اره", "سلام", "متاسفانه"}


def _any(pats: list[str], t: str) -> bool:
    return any(re.search(p, t) for p in pats)


def rule_parse(text: str, ctx: dict) -> dict:
    t = normalize_fa(text)
    kind = ctx.get("kind", "ask")
    out: dict = {"available": None, "price": None, "closes_at": extract_closes_at(t), "opens_at": None, "restock": None,
                 "installment": None, "warranty": None, "original": None, "variants_available": [],
                 "variants_unavailable": [], "alt_suggestion": None, "hold_accepted": None, "answers": {}, "follow_up": None,
                 "missing": [], "engine": "rules"}
    # negatives about side questions («قسطی نداریم», «گارانتی نداره») say nothing about stock
    core = re.sub(r"(?:قسط\S*|اقساط|اعتباری|گارانتی|کارت ?خوان|ارسال)\s*(?:هم\s*)?(?:نداریم|نداره|ندارم|نمی ?گیریم|نمی ?دیم)", " ", t)
    stripped = core
    for p in _NEG:
        stripped = re.sub(p, " ", stripped)
    neg, pos = _any(_NEG, core), _any(_POS, stripped)
    alt = re.search(r"(?:مشابه(?:ش)?|جاش|به ?جاش|به ?جای ?اون)\s+(.+?)\s+(?:رو\s+|را\s+)?(?:داریم|دارم|هست|موجوده|داریمش)", t)
    priced = t
    if alt:
        out["alt_suggestion"] = alt.group(1).strip()[:80]
        pos = _any(_POS, stripped.replace(alt.group(0), " "))
        priced = t.replace(alt.group(0), " ")  # «ردمی بادز ۵» is a model name, not a price
    if kind == "arrive":  # any reply that is not a refusal means «come, I am ready»
        out["available"] = False if neg else True
        out["closes_at"] = None
    elif kind == "hold":
        no, yes = _any(_HOLD_NO, t), _any(_HOLD_YES, t)
        out["hold_accepted"] = False if no else True if yes else None
        out["closes_at"] = None  # «تا ساعت ۶ نگه می‌دارم» is the hold time, not closing time
        if re.search(r"هنوز\s*(?:داریم|هست|موجود)", t):
            out["available"] = True
    elif neg and pos and not re.search(r"(?:قسط|اقساط)", core):
        # «مشکیش تموم شده، سفید داریم»: a variant is out, another is in
        out["available"] = True
        out["variants_unavailable"] = [w.rstrip("ش") for w in re.findall(r"(\S+?)ش?\s+(?:تموم|تمام|نداریم)", t) if w not in _STOP][:3]
        out["variants_available"] = [w for w in re.findall(r"(\S+)\s+(?:داریم|هست|موجوده)", stripped) if w not in _STOP][:3]
        if not out["variants_unavailable"] and not out["variants_available"]:
            out["available"] = not re.search(r"موجود\s*نیست|نداریم|تموم|فروخته", t)
    elif neg:
        out["available"] = False
    elif pos:
        out["available"] = True
    out["price"] = extract_price(priced, ctx.get("listed"))
    if out["available"] is False and out["price"] and not re.search(r"میلیون|هزار|تومن|تومان|قیمت", priced):
        out["price"] = None
    if out["price"] and out["available"] is None and kind != "hold":
        out["available"] = True  # a quoted price means they have it
    m = re.search(r"فردا|پس ?فردا|هفته ?(?:ی)? ?(?:بعد|دیگه|آینده)|(\d+)\s*روز\s*دیگه|اول\s*هفته", t)
    if m:
        out["restock"] = {"فردا": "فردا", "پس فردا": "پس‌فردا", "پسفردا": "پس‌فردا"}.get(m.group(0), m.group(0).replace("هفته ی", "هفتهٔ"))
        out["opens_at"] = extract_opens_at(t)
    if re.search(r"قسط|اقساط|اعتباری|اسنپ ?پی|دیجی ?پی|ترب ?پی|لندو|ازکی", t):
        seg = t[re.search(r"قسط|اقساط|اعتباری|اسنپ ?پی|دیجی ?پی|ترب ?پی|لندو|ازکی", t).start():][:40]
        out["installment"] = not re.search(r"نداریم|نمی ?گیریم|نمیشه|نمی ?شه|\bنه\b|نمی ?پذیریم", seg)
    w = re.search(r"(\d+)\s*ماه(?:ه)?\s*گارانتی\s*(\S+)?|گارانتی\s*(\d+)\s*ماه(?:ه)?\s*(\S+)?", t)
    if w:
        months, company = w.group(1) or w.group(3), w.group(2) or w.group(4)
        out["warranty"] = f"{fa(months)} ماه" + (f" {company.strip('،.')}" if company else "")
    elif re.search(r"گارانتی\s+(\S+)", t) and not re.search(r"گارانتی\s*(?:هم\s*)?(?:نداره|نداریم|ندارد)", t):
        out["warranty"] = re.search(r"گارانتی\s+(\S+(?:\s\S+)?)", t).group(1)[:60]
    if re.search(r"اصل|آکبند|اورجینال|اورجینال|پلمپ", t):
        out["original"] = not re.search(r"اصل\s*نیست|کپی", t)
    elif re.search(r"های ?کپی|کپی", t):
        out["original"] = False
    return out


# ---------------------------------------------------------------- LLM parser
PROMPT = """You read a Tehran shop seller's chat reply to a buyer's inquiry and extract facts. Reply with ONE JSON object:
{"available": true|false|null, "price": number|null, "closes_at": "HH:MM"|null, "opens_at": "HH:MM"|null,
 "restock": string|null, "installment": true|false|null, "warranty": string|null, "original": true|false|null,
 "variants_available": [string], "variants_unavailable": [string], "alt_suggestion": string|null,
 "hold_accepted": true|false|null, "answers": {"<question key>": "short Persian answer"},
 "summary": "one short Persian line for the buyer", "missing": ["<question key still unanswered>"],
 "follow_up": "one short, polite, colloquial Persian question to the seller" | null}
Rules:
- price is in TOMAN exactly as the seller meant it. Sellers drop thousands: «۲۸۵۰» or «۲ و ۸۵۰» for a 2,850,000 item; use the
  listed price as the scale reference. Never invent a price. Hours like «تا ۸ شب» are closes_at (20:00), never a price.
- available=true if they have the item (even only some variants); false if not; null if unclear.
- If the buyer asked about a specific variant (colour, size, storage...) and the reply leaves it unclear, ask about it.
- follow_up only when an asked question that matters is unanswered or the reply is ambiguous; otherwise null.
  For kind=hold the key fact is hold_accepted. For kind=recheck the key fact is available.
- Use only what the seller said. Output JSON only."""


def _clean(raw: dict, ctx: dict) -> dict:
    def b(x):
        return x if isinstance(x, bool) else None

    def s(x, n=80):
        return str(x).strip()[:n] if x not in (None, "", "null") else None

    def hm(x):
        x = s(x, 5)
        return x if x and re.fullmatch(r"\d{2}:\d{2}", x) else None

    def lst(x):
        return [str(i).strip()[:30] for i in x if str(i).strip()][:4] if isinstance(x, list) else []

    price = raw.get("price")
    try:
        price = normalize_price(float(price), ctx.get("listed")) if price not in (None, "", "null") else None
    except (TypeError, ValueError):
        price = None
    keys = set(ctx.get("keys") or [])
    return {"available": b(raw.get("available")), "price": price, "closes_at": hm(raw.get("closes_at")),
            "opens_at": hm(raw.get("opens_at")), "restock": s(raw.get("restock"), 40), "installment": b(raw.get("installment")),
            "warranty": s(raw.get("warranty"), 60), "original": b(raw.get("original")),
            "variants_available": lst(raw.get("variants_available")), "variants_unavailable": lst(raw.get("variants_unavailable")),
            "alt_suggestion": s(raw.get("alt_suggestion")), "hold_accepted": b(raw.get("hold_accepted")),
            "answers": {k: s(v, 80) for k, v in (raw.get("answers") or {}).items() if k in keys and s(v)} if isinstance(raw.get("answers"), dict) else {},
            "summary": s(raw.get("summary"), 140), "missing": [k for k in lst(raw.get("missing")) if k in keys],
            "follow_up": s(raw.get("follow_up"), 160), "engine": "llm"}


_BARG_NO = [r"نمی ?شه", r"نمیشه", r"امکان ندار", r"\bنه\b", r"نمی ?تونم", r"نمی ?دم", r"کمتر ندار", r"پایین ?ترین", r"همین قیمته", r"قیمت ثابت", r"سود ندار"]
_BARG_YES = [r"باشه", r"قبول", r"اوکی", r"\bok\b", r"می ?دم", r"میدم", r"حله", r"موافق", r"تشریف بیار", r"بیایید"]


def _bargain(rules: dict, text: str, ctx: dict) -> dict:
    """Did the shop take the target, answer with its own number, or refuse? Stock is not judged here: this is a price conversation."""
    target = ctx.get("target") or 0
    t = re.sub(r"\s+", " ", (text or "").replace("\u200c", " "))  # «نمی‌شه» is written with a half-space
    price = rules.get("price")
    no, yes = _any(_BARG_NO, t), _any(_BARG_YES, t)
    if price and target and price <= target:
        accepted, final = True, price
    elif price and target and price > target:
        accepted, final = False, price            # a counter-offer
    elif yes and not no:
        accepted, final = True, target or None
    elif no:
        accepted, final = False, price
    else:
        accepted, final = None, price
    return {**rules, "available": None, "price": final, "bargain_accepted": accepted, "closes_at": None}


async def parse_reply(text: str, ctx: dict, llm=None) -> dict:
    """ctx: kind, title, keys, questions (texts), note, listed, hold_until, thread [(role, text)]."""
    rules = rule_parse(text, ctx)
    if ctx.get("kind") == "bargain":
        return _bargain(rules, text, ctx)
    if ctx.get("kind") == "arrive" or not (llm and getattr(llm, "configured", False)):
        return rules
    user = json.dumps({"kind": ctx.get("kind", "ask"), "product": ctx.get("title"), "listed_price_toman": ctx.get("listed"),
                       "questions": dict(zip(ctx.get("keys") or [], ctx.get("questions") or [])), "buyer_note": ctx.get("note"),
                       "hold_until": ctx.get("hold_until"), "conversation": ctx.get("thread", [])[-6:], "seller_reply": text},
                      ensure_ascii=False)
    try:
        got = _clean(await llm.complete_json([{"role": "system", "content": PROMPT}, {"role": "user", "content": user}]), ctx)
    except Exception:
        return rules
    # the LLM is better at nuance, the rules never miss an explicit number/time: fill gaps from the rules
    for k in ("price", "closes_at", "restock", "alt_suggestion"):
        if got[k] is None and rules[k] is not None:
            got[k] = rules[k]
    if got["available"] is None:
        got["available"] = rules["available"]
    if ctx.get("kind") == "hold" and got["hold_accepted"] is None:
        got["hold_accepted"] = rules["hold_accepted"]
    return got


def merge(old: dict | None, new: dict) -> dict:
    """Combine what a seller said over several messages; later non-empty facts win."""
    if not old:
        return dict(new)
    out = dict(old)
    for k, v in new.items():
        if k in ("missing", "follow_up", "summary", "engine"):
            out[k] = v  # judged on the whole conversation so far: the newest reading replaces the old one
        elif k == "answers":
            out["answers"] = {**(old.get("answers") or {}), **(v or {})}
        elif isinstance(v, list):
            out[k] = v or old.get(k) or []
        elif v is not None:
            out[k] = v
    return out


def follow_up(parsed: dict, ctx: dict, turns: int) -> str | None:
    """The agent's next question to the seller, or None when the answer is complete enough."""
    if turns >= MAX_FOLLOW_UPS:
        return None
    kind, keys = ctx.get("kind", "ask"), ctx.get("keys") or []
    if kind == "hold":
        if parsed.get("hold_accepted") is None:
            return f"ببخشید، یعنی تا ساعت {fa(ctx.get('hold_until') or '')} برایش نگه می‌دارید؟ (بله / نه)"
        return None
    if kind in ("bargain", "arrive"):
        return None  # a price talk or an «I'm here» is never followed by «do you have it?»
    if parsed.get("available") is None:
        return parsed.get("follow_up") or ("ببخشید، یعنی هنوز موجود است؟" if kind == "recheck" else "ببخشید، الان موجود دارید یا نه؟")
    if parsed.get("available") is False:
        return None
    if parsed.get("engine") == "llm" and parsed.get("follow_up") and parsed.get("missing"):
        return parsed["follow_up"]  # the model can ask for several missing things in one natural sentence
    if kind == "ask" and "price" in keys and not parsed.get("price"):
        return "ممنون. قیمت نهایی امروزش چند است؟"
    if kind == "ask" and parsed.get("variants_unavailable") and not parsed.get("variants_available") and ctx.get("note"):
        return f"مدلی که مشتری خواسته («{ctx['note'][:40]}») را دارید؟"
    return None


def summary(p: dict, kind: str = "ask") -> str:
    if kind == "bargain":
        acc = p.get("bargain_accepted")
        return (f"قبول کرد: {money(p['price'])} تومان" if acc and p.get("price") else "قبول کرد" if acc
                else f"قبول نکرد؛ پایین‌ترین قیمتش {money(p['price'])} تومان" if p.get("price") else "قبول نکرد" if acc is False else "پاسخ نامشخص")
    if kind == "arrive":
        return "فروشنده منتظر شماست" if p.get("available") is not False else "فروشنده الان نمی‌تواند پاسخ بدهد"
    if kind == "hold":
        return "قبول کرد نگه دارد" if p.get("hold_accepted") else "نمی‌تواند نگه دارد" if p.get("hold_accepted") is False else "پاسخ نامشخص"
    parts = ["موجود است" if p.get("available") else "موجود نیست" if p.get("available") is False else "نامشخص"]
    if p.get("price"):
        parts.append(f"{money(p['price'])} تومان")
    if p.get("variants_available"):
        parts.append("موجود: " + "، ".join(p["variants_available"]))
    if p.get("variants_unavailable"):
        parts.append("تمام شده: " + "، ".join(p["variants_unavailable"]))
    if p.get("restock"):
        parts.append(f"دوباره می‌آید: {p['restock']}")
    if p.get("closes_at"):
        parts.append(f"باز تا {fa(p['closes_at'])}")
    return " · ".join(parts)


# ---------------------------------------------------------------- product-aware questions
_SUGGEST_CACHE: dict[str, list[dict]] = {}
_spent = {"day": "", "n": 0}
DAILY_CAP = 300

SUGGEST_PROMPT = """You help a shopper in Tehran ask a physical shop about a product before going there. Given the product,
propose up to 3 SHORT questions (Persian, colloquial-polite, max 60 chars each) that a seller can answer by chat and that
matter for THIS product: the exact variant (storage/RAM/colour/size), original vs copy, registered (رجیستر) for phones,
warranty company, what is in the box. Do NOT repeat: stock, price, opening hours, installments, warranty duration.
Reply JSON: {"questions": [{"text": "...", "why": "short Persian reason"}]}"""


def _rules_questions(p: dict) -> list[dict]:
    cat = normalize_fa(p.get("category") or "") + " " + normalize_fa(p.get("title") or "")
    specs = {normalize_fa(s["key"] or ""): s["value"] for s in p.get("specs") or []}
    out = []

    def spec(*names):
        for k, v in specs.items():
            if any(n in k for n in names):
                return v
        return None

    if re.search(r"گوشی|موبایل|تبلت|mobile|phone", cat):
        out.append({"text": "نسخهٔ رجیستر‌شده و دارای گارانتی معتبر است؟", "why": "گوشی رجیستر نشده بعد از ۳۰ روز قطع می‌شود"})
        mem = spec("حافظه داخلی", "حافظه")
        out.append({"text": f"همین نسخهٔ {mem} موجود است؟" if mem else "کدام حافظه و رنگ‌ها موجود است؟", "why": "قیمت‌ها بین نسخه‌ها فرق دارد"})
    elif re.search(r"لپ ?تاپ|نوت ?بوک|laptop", cat):
        ram, ssd = spec("رم", "حافظه رم"), spec("حافظه داخلی", "ظرفیت")
        out.append({"text": f"دقیقاً همین پیکربندی ({ram or 'رم'} / {ssd or 'حافظه'}) است؟", "why": "لپ‌تاپ‌ها با پیکربندی‌های مختلف فروخته می‌شوند"})
        out.append({"text": "آکبند است یا استوک؟", "why": "استوک ارزان‌تر است ولی گارانتی کمتری دارد"})
    elif re.search(r"کفش|کتونی|لباس|پوشاک|مانتو|شلوار|پیراهن|تی ?شرت", cat):
        out.append({"text": "چه سایزهایی موجود است؟", "why": "سایز معمولاً زودتر از مدل تمام می‌شود"})
    elif re.search(r"هدفون|هندزفری|ایرپاد|اسپیکر|ساعت هوشمند|شارژر|پاوربانک", cat):
        out.append({"text": "اصل است یا های‌کپی؟", "why": "در این دسته نمونهٔ تقلبی زیاد است"})
    if not out:
        out.append({"text": "آکبند و اصل است؟", "why": "پیش از رفتن مطمئن شوید"})
    return out[:3]


def _budget_ok() -> bool:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _spent["day"] != day:
        _spent.update(day=day, n=0)
    return _spent["n"] < DAILY_CAP


async def suggest_questions(p: dict, llm=None) -> list[dict]:
    """[{key:'c1', text, why, source:'llm'|'rules'}] for one product. Cached per product."""
    pid = p["product_id"]
    if pid in _SUGGEST_CACHE:
        return _SUGGEST_CACHE[pid]
    items, source = None, "rules"
    if llm and getattr(llm, "configured", False) and _budget_ok():
        _spent["n"] += 1
        user = json.dumps({"title": p["title"], "brand": p.get("brand"), "category": p.get("category"),
                           "specs": [f"{s['key']}: {s['value']}" for s in (p.get("specs") or [])[:25]]}, ensure_ascii=False)
        try:
            raw = await llm.complete_json([{"role": "system", "content": SUGGEST_PROMPT}, {"role": "user", "content": user}])
            items = [{"text": str(q.get("text", "")).strip()[:70], "why": str(q.get("why", "")).strip()[:90]}
                     for q in raw.get("questions", []) if isinstance(q, dict) and str(q.get("text", "")).strip()][:3]
            source = "llm"
        except Exception:
            items = None
    if not items:
        items, source = _rules_questions(p), "rules"
    out = [{"key": f"c{i + 1}", "text": q["text"], "why": q["why"], "source": source} for i, q in enumerate(items)]
    if len(_SUGGEST_CACHE) > 2000:
        _SUGGEST_CACHE.clear()
    _SUGGEST_CACHE[pid] = out
    return out
