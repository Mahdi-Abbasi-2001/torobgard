"""Shop groups: the ~4,000 fine-grained categories boiled down to a dozen kinds of market stall, so the map can say at a glance
«this block is phones, that one is lighting». A shop's group is the one most of its declared categories fall in (the «سایر …» buckets
say nothing and are ignored). Matching is by keywords on the Persian category name, most specific kinds first."""
from __future__ import annotations

import re

from .text import normalize_fa

# (key, label, keywords): first match wins, so specific kinds come before general ones
GROUPS: list[tuple[str, str, list[str]]] = [
    ("security", "دوربین و امنیتی", ["دوربین", "دزدگیر", "نظارتی", "امنیتی", "آژیر", "فلاشر"]),
    ("lighting", "لامپ و روشنایی", ["لامپ", "چراغ", "روشنایی", "نور", "ریسه", "پروژکتور", "لوستر", "آباژور", "سر پیچ", "led"]),
    ("mobile", "موبایل و لوازم", ["گوشی", "موبایل", "تبلت", "پاوربانک", "ساعت و مچ بند", "type c", "lightning", "usb", "otg", "شارژر", "عینک هوشمند", "دانگل", "پاور استیشن"]),
    ("computer", "کامپیوتر و شبکه", ["هارد", "ماوس", "کارت حافظه", "مودم", "شبکه", "سوییچ و اسپلیتر", "لپ تاپ", "کامپیوتر", "پرینتر", "کیبورد", "فلش", "مانیتور", "ssd", "حافظه", "اندروید باکس", "گیم پد", "کنسول", "قلم لمسی", "دسته بازی", "پروگرامر", "rfid"]),
    ("audio", "صوتی و تصویری", ["هدفون", "هندزفری", "اسپیکر", "صوتی", "میکروفون", "تلویزیون", "hdmi", "aux", "آنتن", "ضبط", "ساندبار", "سابووفر", "آمپلی", "ایرپاد", "ادوات موسیقی", "استند و پایه ادوات", "اسپیکر"]),
    ("beauty", "آرایشی و سلامت", ["آرایش", "آرایشی", "بهداشت", "بهداشتی", "زیبایی", "کرم", "ماسک", "مراقبت", "پوست", "عطر", "ادکلن", "لوسیون", "سرم", "ضد آفتاب", "شامپو", "رنگ مو", "فرکننده", "آرایش لب", "فشارسنج", "فشار خون", "تشک طبی", "بالش طبی", "تونر", "میسلار", "رنگ تاتو", "پزشکی", "قند", "اکسیژن", "نبولایزر", "فیزیوتراپی", "سلامت", "سرنگ", "مکمل", "ضربان", "نوار قلب", "ترمیم", "جوانساز", "لیفتینگ", "میکرونیدلینگ", "میکرودرم", "مرطوب", "آبرسان", "چشم و ابرو", "ویتامین", "گیاهی", "دمنوش", "چای", "قهوه خام"]),
    ("home", "لوازم خانه و شخصی", ["لباسشویی", "سشوار", "ماساژ", "بخور", "هواکش", "پنکه", "جارو", "تصفیه", "مسواک", "اصلاح", "واتر جت", "کولر", "رطوبت", "یخچال", "اتو", "پزشکی", "فشارسنج", "ترازو", "کمپرس", "صورت", "فن", "تهویه", "قهوه", "آشپزخانه", "سرخ کن", "هواپز", "فلاسک", "ماگ", "شیکر", "خوشبو", "حوله", "پتو", "بالش", "روبالشی", "روفرشی", "توالت", "نظافت", "فرچه", "قمقمه"]),
    ("fashion", "پوشاک و کیف", ["پیراهن", "مانتو", "تاپ", "تیشرت", "کت", "شلوار", "کفش", "لباس", "کیف", "دامن", "کاپشن", "سویشرت", "ژاکت", "لگینگ", "سارافون", "پافر", "بادی", "شومیز", "نیم تنه", "پوشاک", "صندل", "پالتو", "روسری", "شال", "بلوز", "ست مادر", "عبا", "شکت", "بوت", "گوشواره", "دستبند", "عینک آفتابی", "کمربند", "ساعت مچی", "اشارپ", "رودوشی", "جوراب", "کلاه", "دستکش", "مجلسی"]),
    ("tools", "ابزار و صنعتی", ["ابزار", "دریل", "پیچ گوشتی", "پمپ", "کمپرسور", "سمپاش", "بست", "یراق", "لوله", "چسب", "گیج", "مانومتر", "پنوماتیک", "الکتروموتور", "کارواش", "خودرو", "موتور", "اتصالات", "قطعات صنعتی", "سیم چین", "کف کش", "انبر", "کلمپ", "فرز", "کاتر", "میخ", "پیچ", "آچار", "بکس", "گیره", "هیتر", "هویه", "لحیم", "قفل", "درب بازکن", "چشمی", "تجهیزات صنعتی", "فلوسوئیچ", "فلومتر", "اسپری صنعتی", "واشر", "گلند", "منبع تحت فشار", "جت فن", "بلوور", "منگنه", "میخکوب", "قطعات ماشین", "ریل", "پنس", "متر لیزری", "ذره بین", "ترمومتر صنعتی", "آتش نشانی", "اعلام حریق", "دتکتور", "پنل خورشیدی", "آزمایشگاهی", "قرنیز", "پروفیل", "وارنیش", "حرارتی", "المنت", "موزن", "فلوتر", "شناور", "رول پلاک"]),
    ("electrical", "برق و الکترونیک", ["کلید", "پریز", "سیم", "کابل", "سوکت", "کانکتور", "فیوز", "کنتاکتور", "رله", "ترانس", "استابلایزر", "بالاست", "تابلو", "چندراهی", "آداپتور", "منبع تغذیه", "تایمر", "ترموستات", "باتری", "ups", "ژنراتور", "اینورتر", "ترمینال", "داکت", "خازن", "سنسور", "اتوماسیون", "درایو", "شیر برقی", "برق", "الکترونیک", "ماژول", "فتوسل", "شاسی", "جعبه تقسیم", "مولتی متر", "کابلشو", "دماسنج", "کنترل بار", "فاز", "سوئیچ", "سوییچ", "دیود", "ترانزیستور", "مقاومت", "آی سی", "میکرو", "برد", "ولوم", "پتانسیومتر", "دیمر", "ترموکوپل", "وات متر", "پاور متر", "ریموت", "نمایشگر", "آمپر", "ولتاژ", "پراب", "انکودر", "کانتر", "شمارنده", "رگلاتور", "ماژول", "سایر الکترونیکی", "کنترلر", "آیفون تصویری", "برق"]),
]
OTHER = ("other", "سایر")
LABEL = {k: l for k, l, _ in GROUPS} | {OTHER[0]: OTHER[1]}
_SKIP = re.compile(r"^سایر")


def _starts_a_word(word: str, name: str) -> bool:
    """A keyword counts only at the start of a word («کت» is a jacket, not the middle of «کنتاکتور»)."""
    w = normalize_fa(word).lower()
    return re.search(r"(?<![\u0600-\u06FFa-z0-9])" + re.escape(w), name) is not None


def group_of(category: str | None) -> str:
    """The group a category name belongs to."""
    name = normalize_fa(category or "").lower().replace("\u200c", " ")
    for key, _, words in GROUPS:
        if any(_starts_a_word(w, name) for w in words):
            return key
    return OTHER[0]


_CACHE: dict[int, dict[str, str]] = {}


def shop_groups(con) -> dict[str, str]:
    """shop_id -> its dominant group. Built once per process (the catalogue does not change while the server runs)."""
    key = id(con) if False else 0
    if key in _CACHE:
        return _CACHE[key]
    counts: dict[str, dict[str, int]] = {}
    cat_group: dict[str, str] = {}
    for sid, cat in con.execute("SELECT shop_id, category FROM shop_categories"):
        if not cat or _SKIP.match(cat.strip()):
            continue
        g = cat_group.get(cat) or cat_group.setdefault(cat, group_of(cat))
        if g == OTHER[0]:
            continue
        d = counts.setdefault(sid, {})
        d[g] = d.get(g, 0) + 1
    # shops whose only categories are the vague «سایر …» ones: read the kind off those names instead (« سایر قطعات الکترونیکی» is still electronics)
    vague: dict[str, dict[str, int]] = {}
    for sid, cat in con.execute("SELECT shop_id, category FROM shop_categories"):
        if sid in counts or not cat:
            continue
        g = group_of(_SKIP.sub("", cat.strip()))
        if g != OTHER[0]:
            d = vague.setdefault(sid, {}); d[g] = d.get(g, 0) + 1
    for sid, d in vague.items():
        counts[sid] = d
    # shops with no declared categories at all: what they actually list (the categories of their offers' products)
    offer_g: dict[str, dict[str, int]] = {}
    for sid, cat in con.execute("SELECT o.shop_id, p.category FROM offers o JOIN products p USING(product_id)"):
        if sid in counts or not cat:
            continue
        g = cat_group.get(cat) or cat_group.setdefault(cat, group_of(cat))
        if g != OTHER[0]:
            d = offer_g.setdefault(sid, {}); d[g] = d.get(g, 0) + 1
    for sid, d in offer_g.items():
        counts[sid] = d
    order = [k for k, _, _ in GROUPS]
    out = {sid: max(d, key=lambda g: (d[g], -order.index(g))) for sid, d in counts.items()}
    _CACHE[key] = out
    return out
