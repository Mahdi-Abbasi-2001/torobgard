"""Intake agent: turns what the shopper wrote into a complete mission, and asks when it is not sure.

A tool-calling loop (like the chat agent) with tools that look at the real catalogue, so every slot it fills is grounded:
  search_catalog  does a shop list this exactly? which categories does the phrase fall into?
  price_spread    how wide are the prices? (turns «budget?» into real ranges)
  lookup_place    a mall or area that really exists in the data
  category_needs  what «for what?» options exist for this category
  submit_mission  the result: slots, what it assumed, and at most two questions with tap-able options
Without an LLM the same shape comes from the rule parser plus rule questions, so the screen never breaks.
Nothing here invents a product, price or shop; it only fills slots and asks."""
from __future__ import annotations
import json
import re
from typing import AsyncIterator

from ..services import catalog, discover, mission
from ..services.hours import now_tehran
from ..services.text import normalize_fa
from .llm import LLMUnavailable, OpenAICompatLLM

MAX_STEPS = 6
BUDGET_WORDS = re.compile(r"[0-9۰-۹]|میلیون|ملیون|هزار|تومن|تومان|بودجه|گران|ارزان|اقتصادی|ناقابل")
WHEN_OK = re.compile(r"^(?:now|1h|evening|tomorrow|\d{2}:\d{2})$")
SLOTS = ("query", "need", "budget", "place", "when", "mode", "other")

TOOLS = [
    {"type": "function", "function": {"name": "search_catalog", "description": "Search the shop catalogue for a product phrase. Returns whether shops list it exactly, how many products, example titles and the categories the phrase falls into.",
     "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "short Persian product words, no budget/time/place"}, "category": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "price_spread", "description": "How wide the listed prices are for a product phrase (toman): cheap / middle / expensive cut-offs. Use it to offer budget options.",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "category": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "lookup_place", "description": "Find a mall or neighbourhood in Tehran that exists in the data. With an empty name it lists popular areas.",
     "parameters": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}}},
    {"type": "function", "function": {"name": "category_needs", "description": "What «for what / for whom» options exist for a category (labels the shopper can pick).",
     "parameters": {"type": "object", "properties": {"category": {"type": "string"}}, "required": ["category"]}}},
    {"type": "function", "function": {"name": "submit_mission", "description": "Final step: submit the completed slots and any questions. Call it exactly once.",
     "parameters": {"type": "object", "properties": {
         "query": {"type": "string", "description": "the product words shops list exactly"},
         "category": {"type": ["string", "null"]},
         "more_items": {"type": "array", "maxItems": 4, "items": {"type": "string"}, "description": "other DIFFERENT products the shopper also wants in the same trip (each a short phrase as shops list it); the first product stays in query"},
         "need": {"type": ["string", "null"], "description": "what it is for / for whom, short (ورزش, بچه, هدیه)"},
         "budget_min": {"type": ["integer", "null"]}, "budget_max": {"type": ["integer", "null"]},
         "place_name": {"type": ["string", "null"], "description": "mall or area the shopper named or chose"},
         "when": {"type": ["string", "null"], "description": "now | 1h | evening | tomorrow | HH:MM"},
         "mode": {"type": ["string", "null"], "enum": ["walk", "taxi", "car", None]},
         "installment": {"type": "boolean"}, "open_only": {"type": "boolean"},
         "assumed": {"type": "array", "items": {"type": "string", "enum": ["place", "when", "mode", "budget", "need"]}, "description": "slots you filled with a default because the shopper did not say"},
         "summary": {"type": "string", "description": "one short Persian sentence: what you understood"},
         "questions": {"type": "array", "maxItems": 2, "items": {"type": "object", "properties": {
             "slot": {"type": "string", "enum": list(SLOTS)}, "text": {"type": "string"},
             "options": {"type": "array", "items": {"type": "string"}, "maxItems": 5}}, "required": ["slot", "text"]}}},
         "required": ["query", "summary"]}}},
]

SYSTEM = """تو «ترب‌گرد» هستی، دستیار خرید حضوری در بازارهای تهران. اینجا مرحلهٔ ورودی است: از حرف‌های کاربر باید همهٔ اطلاعات خرید را بیرون بکشی و جاهای خالی را پر کنی تا مسیر خرید کامل شود. هر چیزی را که می‌نویسی باید با ابزارها روی داده‌های واقعی چک شده باشد؛ حدس نزن.

اطلاعات خرید (slot ها):
- query: اسم کالا، کوتاه و به شکلی که فروشگاه‌ها ثبتش کرده‌اند. بودجه، ساعت، محل و «برای چه» را داخلش نگذار. اول search_catalog بزن؛ اگر exact=false بود کلمه‌ها را کوتاه‌تر یا ساده‌تر کن و دوباره امتحان کن. اگر بعد از دو بار هنوز مبهم بود، از کاربر بپرس و گزینه‌ها را از top_categories بردار.
- need: برای چه کاری یا برای چه کسی (ورزش، بچه، هدیه...). فقط اگر کاربر گفته یا از جمله روشن است.
- بودجه (به تومان): از جمله بیرون بکش. اگر نگفته و قیمت‌ها پراکنده‌اند (price_spread)، یک سؤال با گزینه‌های بازهٔ واقعی بپرس.
- محل: اگر پاساژ یا محله‌ای گفت با lookup_place پیدا کن. اگر نگفته، دربارهٔ محل هرگز سؤال نپرس: کاربر نقطهٔ شروعش را بالای صفحه انتخاب کرده و همان استفاده می‌شود.
- when (now | 1h | evening | tomorrow | HH:MM) و mode (walk | taxi | car): اگر نگفت نپرس؛ فرض کن «الان» و «پیاده» و در assumed بنویس.
- installment و open_only فقط اگر کاربر خواسته.

قواعد:
۰) query را از کلمات خود کاربر بساز و کالای دیگری جایش نگذار («لباس پاییزی» را به «پالتو» تبدیل نکن). اگر کلمه‌اش با چند دستهٔ مختلف جور درمی‌آید، از کاربر بپرس.
۱) جمله‌هایی که کاربر قبلاً داده، یا مقدارهایی که در pinned آمده، کاربر خودش تعیین کرده؛ هرگز عوضشان نکن و دربارهٔشان نپرس.
۲) گزینه‌های سؤال «بودجه» و «محل» را خودت ننویس و options آن‌ها را خالی بگذار؛ سیستم از داده‌های واقعی می‌گذارد. جواب «فرقی نمی‌کند» برای بودجه یعنی محدودیتی نیست و دوباره نپرس. فقط وقتی بپرس که جواب، نتیجه را واقعاً عوض می‌کند. حداکثر دو سؤال، هرکدام کوتاه، محاوره‌ای و محترمانه، با ۲ تا ۵ گزینهٔ کوتاه (هر گزینه حداکثر چند کلمه). اگر جمله روشن است هیچ سؤالی نپرس.
۳) اگر کاربر به سؤال قبلی جواب داده، جواب را در slot مربوط بگذار و دوباره همان را نپرس.
۴) current_slots چیزهایی است که تا اینجا روشن شده؛ همه را بدون تغییر دوباره در submit_mission بگذار مگر آنکه جواب تازهٔ کاربر عوضشان کند. هرگز بودجه یا محلی که قبلاً روشن شده را پاک نکن.
۵) اگر «برای چه/چه کسی» معنای کالا را مشخص می‌کند (مثلاً لباس فرم برای بچه یعنی مدرسه، کفش برای کوه، کیف برای لپ‌تاپ)، با search_catalog یک بار query را با همان کلمه دقیق‌تر امتحان کن و اگر examples به نیاز کاربر نزدیک‌تر شد همان را به‌عنوان query بگذار؛ وگرنه query اصلی بماند. نتیجهٔ دیگری که به نیاز مربوط نیست (لباس فرم نگهبانی برای بچه) نباید در فهرست بالا بیاید.
۶) اگر کاربر چند کالای مختلف خواست («گوشی و قاب و شارژر»)، اولی را در query بگذار و بقیه را در more_items (هر کدام کوتاه، به شکلی که فروشگاه‌ها ثبت کرده‌اند)؛ هر کدام را هم با search_catalog چک کن. برای یک کالای واحد more_items را خالی بگذار.
۷) سؤال دربارهٔ «کدام مدل / کدام محصول» هرگز نپرس و سؤال بدون گزینهٔ قابل‌لمس هم نپرس: بعد از همین مرحله خود کالاها را به کاربر نشان می‌دهیم و او انتخاب می‌کند. سؤال‌های خوب فقط آن‌هایی‌اند که فهرست را واقعاً عوض می‌کنند و با چند گزینهٔ واقعی جواب داده می‌شوند: «برای چه کسی / چه کاری» (مثلاً آقایان یا بانوان، ورزشی یا روزمره، بچه یا بزرگسال)، بودجه، یا انتخاب بین چند دستهٔ مختلف برای یک کلمه. برای «برای چه کسی / چه کاری» حتماً category_needs را صدا بزن و همان گزینه‌های واقعی‌اش را بپرس (slot=need)؛ اگر category_needs گزینهٔ معنی‌داری نداشت نپرس.
۸) فارسی بنویس. summary یک جملهٔ کوتاه است: «چه چیزی فهمیدی».
۸) در پایان submit_mission را دقیقاً یک بار صدا بزن. بدون آن کار تمام نمی‌شود."""

_STATUS = {"search_catalog": "در کاتالوگ فروشگاه‌ها دنبال «{query}» می‌گردم…", "price_spread": "بازهٔ قیمت‌ها را می‌سنجم…",
           "lookup_place": "محل را در نقشهٔ فروشگاه‌ها پیدا می‌کنم…", "category_needs": "گزینه‌های «برای چه» این دسته را می‌خوانم…",
           "submit_mission": "جمع‌بندی می‌کنم…"}


# ------------------------------------------------------------------ tools (all read the real data)
def _search(con, q: str, category: str | None = None) -> dict:
    res = catalog.search_products(con, q, category or None, None, None, None, True, 6, 0)
    cats = catalog.facets(con, q, category or None)["categories"][:5]
    return {"total": res["total"], "exact": bool(res["items"]) and not res.get("relaxed"), "examples": [p["title"][:60] for p in res["items"][:5]],
            "top_categories": [{"name": c["name"], "count": c["count"]} for c in cats]}


def _nice(n: float) -> int:
    """Round a price to two significant figures: 3,297,000 -> 3,300,000."""
    if n <= 0:
        return 0
    mag = 10 ** (len(str(int(n))) - 2)
    return int(round(n / mag) * mag)


def _spread(con, q: str, category: str | None = None) -> dict:
    res = catalog.search_products(con, q, category or None, None, None, None, True, 60, 0)
    prices = sorted(p["price_min"] for p in res["items"] if p.get("price_min"))
    if len(prices) < 5:
        return {"products": len(prices), "note": "قیمت کافی برای پیشنهاد بازه نیست"}
    at = lambda f: _nice(prices[min(len(prices) - 1, int(len(prices) * f))])
    return {"products": len(prices), "cheapest": prices[0], "p25": at(0.25), "median": at(0.5), "p75": at(0.75), "most_expensive": prices[-1]}


def _place(con, name: str) -> dict:
    info, _ = mission._slot_place(con, normalize_fa(name)) if name.strip() else (None, "")
    if info:
        return {"found": True, **info}
    return {"found": False, "popular_areas": [a["label"] for a in discover.areas(con)[:6]]}


GENERIC_LABELS = {p["label"] for p in discover.GENERIC}


async def _needs(con, category: str) -> dict:
    r = await discover.need_presets(con, category, None)  # rules only: cheap and deterministic
    return {"options": [{"label": p["label"], "why": p["why"]} for p in r["presets"][:6]]}


# ------------------------------------------------------------------ result
def _budget_options(con, q: str, category: str | None) -> list[str]:
    sp = _spread(con, q, category) if q else {}
    if not sp.get("p25"):
        return ["فرقی نمی‌کند"]
    a, c = sp["p25"], sp["p75"]
    opts = [f"تا {discover._mil(a)}", f"{discover._mil(a)} تا {discover._mil(c)}", f"بیشتر از {discover._mil(c)}", "فرقی نمی‌کند"] if a != c else ["فرقی نمی‌کند"]
    return opts


def _place_options(con) -> list[str]:
    return [a["label"] for a in discover.areas(con)[:4]] + ["موقعیت فعلی من"]


def _clean_questions(qs) -> list[dict]:
    out = []
    for q in (qs or [])[:2]:
        if not isinstance(q, dict) or not str(q.get("text") or "").strip():
            continue
        slot = q.get("slot") if q.get("slot") in SLOTS else "other"
        opts = [str(o).strip()[:32] for o in (q.get("options") or []) if str(o).strip()][:5]
        out.append({"slot": slot, "text": str(q["text"]).strip()[:140], "options": opts})
    return out


def _more_items(con, main: str, raw) -> list[dict]:
    """The other products of a multi-item sentence: only those the catalogue really lists (an exact match), never the main item again."""
    out, seen = [], {normalize_fa(main)}
    for x in (raw or [])[:4]:
        q = re.sub(r"\s+", " ", str(x or "")).strip()[:60]
        if not q or normalize_fa(q) in seen:
            continue
        seen.add(normalize_fa(q))
        ex = _search(con, q)
        if ex["exact"]:
            out.append({"query": q, "category": (ex["top_categories"][0]["name"] if ex["top_categories"] else None)})
    return out


def _result(con, a: dict, trace: list[str], engine: str, text: str, need_opts: list[str] | None = None, budget_known: bool = False) -> dict:
    q = re.sub(r"\s+", " ", str(a.get("query") or "")).strip()[:80]
    questions = [x for x in _clean_questions(a.get("questions")) if x["slot"] != "place"]  # the start point is the location chip's job, never a question
    for qu in questions:  # options for budget and place come from the data, never from the model's memory
        if qu["slot"] == "budget":
            qu["options"] = _budget_options(con, q, a.get("category"))
        elif qu["slot"] == "place":
            qu["options"] = _place_options(con)
        elif qu["slot"] == "need":
            qu["options"] = (need_opts or [])[:5]
        elif qu["slot"] == "query":  # "which one did you mean?" is answered with the catalogue's own categories that really contain the word
            qt = set(normalize_fa(q).split())
            cats = [c["name"] for c in _search(con, q, a.get("category")).get("top_categories", []) if qt and qt <= set(normalize_fa(c["name"]).split())]
            qu["options"] = cats[:4] if len(cats) >= 2 else []  # one match is no choice, none is a free-text question
    # a "what for?" question with nothing real to tap is noise; the shopper can still type in the box
    # only questions with real things to tap survive: «which model?» in a text box is the next screen's job (the shopper sees the products and picks)
    questions = [qu for qu in questions if qu["options"] or qu["slot"] == "budget"]
    ex = _search(con, q, a.get("category")) if q else {"exact": False, "top_categories": []}
    if a.get("category") and q and not ex["exact"]:  # a category the model picked that hides every result is worse than none
        a = {**a, "category": None}
        ex = _search(con, q, None)
    place = None
    if a.get("place_name"):
        p = _place(con, str(a["place_name"]))
        place = {k: p[k] for k in ("kind", "label", "lat", "lon", "mall_key", "area") if k in p} if p.get("found") else None
    filled = {"budget": bool(a.get("budget_min") or a.get("budget_max")), "place": place is not None, "need": bool(a.get("need"))}
    questions = [qu for qu in questions if not filled.get(qu["slot"])]  # never ask about what it already found
    when = a.get("when") if isinstance(a.get("when"), str) and WHEN_OK.match(a["when"]) else None
    mode = a.get("mode") if a.get("mode") in ("walk", "taxi", "car") else None
    bmin, bmax = (a.get("budget_min") or None), (a.get("budget_max") or None)
    if (bmin or bmax) and not budget_known and not BUDGET_WORDS.search(text):  # a budget comes from the shopper's words, never from the model's reading of the price spread
        bmin = bmax = None
    if bmin and bmax and bmin >= bmax:  # "around two million" is a band, not a point
        bmin, bmax = _nice(bmax * 0.75), _nice(bmax * 1.25)
    return {
        "slots": {"query": q or None, "category": (str(a["category"])[:60] if a.get("category") else None), "need": (str(a["need"]).strip()[:40] if a.get("need") else None),
                  "budget": {"min": bmin, "max": bmax} if (bmin or bmax) else None, "place": place, "when": when, "mode": mode,
                  "conditions": {"installment": bool(a.get("installment")), "open": bool(a.get("open_only"))}, "more": _more_items(con, q, a.get("more_items"))},
        "exact": bool(ex["exact"]), "questions": questions,
        "assumed": [s for s in (a.get("assumed") or []) if s in ("place", "when", "mode", "budget", "need")],
        "summary": str(a.get("summary") or "")[:200], "engine": engine, "trace": trace,
    }


def _broad_question(con, res: dict) -> None:
    """A word that fits several different kinds of product («کفش»: sneakers, formal, women's, work boots…) must not jump straight to a list that mixes them:
    ask which kind, with the catalogue's own categories as the buttons. Not asked when one category clearly dominates or the shopper already chose one."""
    q, cat = res["slots"].get("query"), res["slots"].get("category")
    if not q or cat or any(x["slot"] in ("query", "need") for x in res["questions"]) or len(res["questions"]) >= 2:
        return
    cats = _search(con, q).get("top_categories", [])
    total = sum(c["count"] for c in cats)
    if len(cats) >= 2 and total and cats[0]["count"] / total < 0.55:
        res["questions"].append({"slot": "query", "text": "کدام نوعش را می‌خواهید؟", "options": [c["name"] for c in cats[:4]]})


# ------------------------------------------------------------------ rules fallback (no LLM): same shape
def rules_intake(con, text: str, pinned: dict | None = None) -> dict:
    p = mission.parse(con, text)
    q = p["query"] or ""
    a = {"query": q, "category": p["category"], "need": p["need"], "budget_min": (p["budget"] or {}).get("min"), "budget_max": (p["budget"] or {}).get("max"),
         "place_name": (p["place"] or {}).get("label"), "when": p["when"], "mode": p["mode"], "installment": p["conditions"]["installment"],
         "open_only": p["conditions"]["open"], "assumed": [s for s, v in (("when", p["when"]), ("mode", p["mode"])) if not v], "summary": f"فهمیدم دنبال «{q}» هستید." if q else "", "questions": []}
    qs = []
    ex = _search(con, q) if q else {"exact": False, "top_categories": []}
    if q and not ex["exact"] and ex["top_categories"]:
        qs.append({"slot": "query", "text": f"«{q}» را دقیقاً پیدا نکردم؛ منظورتان کدام است؟", "options": [c["name"] for c in ex["top_categories"][:4]]})
    if q and ex["exact"] and not (a["budget_min"] or a["budget_max"]):
        if _spread(con, q).get("p25"):
            qs.append({"slot": "budget", "text": "بودجه‌تان تقریباً چقدر است؟", "options": []})
    a["questions"] = qs[:2]
    res = _result(con, a, [], "rules", text)
    if not (pinned or {}).get("query"):  # first round only: an answered round already carries the query
        _broad_question(con, res)
    return res


# ------------------------------------------------------------------ the loop
async def run_intake(con, messages: list[dict], slots: dict, pinned: list[str], llm: OpenAICompatLLM | None = None) -> AsyncIterator[dict]:
    """messages: [{role: user|agent, text}]; slots: what the screen has now; pinned: slots the shopper set by hand."""
    llm = llm or OpenAICompatLLM()
    text_all = " ".join(m["text"] for m in messages if m.get("role") == "user")
    if not llm.configured:
        yield {"type": "result", **rules_intake(con, text_all, slots)}
        return
    now = now_tehran()
    payload = {"now_tehran": now.strftime("%Y-%m-%d %H:%M"), "conversation": [{"role": m["role"], "text": m["text"]} for m in messages][-10:],
               "current_slots": slots, "pinned": pinned}
    convo = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]
    trace: list[str] = []
    try:
        for step in range(MAX_STEPS):
            last = step == MAX_STEPS - 1
            if last:
                convo.append({"role": "system", "content": "همین حالا submit_mission را صدا بزن."})
            text, calls = "", None
            async for kind, val in llm.stream(convo, [t for t in TOOLS if t["function"]["name"] == "submit_mission"] if last else TOOLS):
                if kind == "text":
                    text += val
                else:
                    calls = val
            if not calls:
                break  # the model answered in prose: use the rules rather than guess
            convo.append({"role": "assistant", "content": text or None, "tool_calls": [
                {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}} for c in calls]})
            for c in calls:
                try:
                    args = json.loads(c["arguments"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                if c["name"] == "submit_mission":
                    yield {"type": "status", "text": _STATUS["submit_mission"]}
                    need_opts = []
                    if args.get("category"):  # only the category's own needs, not the generic ones every category gets
                        need_opts = [o["label"] for o in (await _needs(con, str(args["category"])))["options"] if o["label"] not in GENERIC_LABELS]
                    res = _result(con, args, trace, "llm", text_all, need_opts, budget_known=bool((slots or {}).get("budget")))
                    rounds = sum(1 for m in messages if m.get("role") == "agent")
                    if rounds >= 2:
                        res["questions"] = []  # two rounds of questions is the limit: from here the shopper edits on the next screen
                    elif rounds == 0:
                        _broad_question(con, res)
                    yield {"type": "result", **res}
                    return
                label = _STATUS.get(c["name"], "در حال بررسی…").format(query=str(args.get("query", ""))[:30])
                trace.append(label)
                yield {"type": "status", "text": label}
                try:
                    if c["name"] == "search_catalog":
                        out = _search(con, str(args.get("query", "")), args.get("category"))
                    elif c["name"] == "price_spread":
                        out = _spread(con, str(args.get("query", "")), args.get("category"))
                    elif c["name"] == "lookup_place":
                        out = _place(con, str(args.get("name", "")))
                    elif c["name"] == "category_needs":
                        out = await _needs(con, str(args.get("category", "")))
                    else:
                        out = {"error": "unknown tool"}
                except Exception as e:  # a tool bug must not kill the intake
                    out = {"error": str(e)[:160]}
                convo.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out, ensure_ascii=False)[:4000]})
    except LLMUnavailable:
        pass
    yield {"type": "result", **rules_intake(con, text_all, slots)}
