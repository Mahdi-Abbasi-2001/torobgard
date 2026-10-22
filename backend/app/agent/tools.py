"""Deterministic tools the LLM can call. Each returns (result_for_llm, ui_block|None).
The LLM only ever sees compact, grounded data; the UI gets rich typed blocks."""
from __future__ import annotations
from typing import Any

from ..services import catalog, inquiries as inq
from ..services.text import split_budget

TOOLS = [
    {"type": "function", "function": {
        "name": "search_products",
        "description": "Search the Tehran product catalogue. query = ONLY the product noun/brand/model (1-3 Persian words, e.g. «هندزفری گردنی», «گوشی سامسونگ»). NEVER put the use-case (ورزش، عکاسی، گیمینگ) or the budget in the query: use price_max/price_min (toman) for budget, and judge use-case from the returned titles. If results are in the wrong category, search again with `category` set to one of top_categories. Returns top products that at least one shop sells.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}, "category": {"type": "string"}, "brand": {"type": "string"},
            "price_min": {"type": "integer"}, "price_max": {"type": "integer"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "compare_products",
        "description": "Compare 2-4 products by spec. Use after search_products when the user is choosing between models.",
        "parameters": {"type": "object", "properties": {"product_ids": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 4}}, "required": ["product_ids"]}}},
    {"type": "function", "function": {
        "name": "find_shops",
        "description": "Find shops near the user that sell a chosen product, ranked. Honors installment/open-now filters. Shops with tier 'listed' registered an offer; 'category_only' merely work in the category and must be asked.",
        "parameters": {"type": "object", "properties": {
            "product_id": {"type": "string"}, "radius_km": {"type": "number"}, "installment": {"type": "boolean"},
            "open_now": {"type": "boolean"}, "fast_delivery": {"type": "boolean"}, "price_max": {"type": "integer"},
            "sort": {"type": "string", "enum": ["best", "price", "distance", "freshness"]},
            "when": {"type": "string", "description": "when the user will go: now | 1h | evening | tomorrow | HH:MM (opening state is judged then)"},
            "priority": {"type": "string", "enum": ["balanced", "price", "near", "trust", "now"], "description": "what matters most to the user"}},
            "required": ["product_id"]}}},
    {"type": "function", "function": {
        "name": "similar_products",
        "description": "Alternatives to a product (same category, similar price). Use when the user wants other options or when few shops have the product.",
        "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]}}},
    {"type": "function", "function": {
        "name": "where_to_look",
        "description": "When the product is not found, no shop lists it, or the user asks where to buy something: returns the malls/areas where shops of that category concentrate (from the dataset's real shop locations) with map links, and renders a location widget. Put your own general knowledge of Tehran's market clusters (a short place phrase, e.g. «بازار بزرگ تهران، راسته کفاش‌ها») in knowledge_hint; it is shown as unverified.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "product phrase, e.g. «کفش کتونی»"}, "knowledge_hint": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {
        "name": "product_review",
        "description": "Short honest review of a product: pros/cons grounded in its real specs, in-shop buying tips, and (if the brand is well known) an unverified general reputation line. Use when the user asks if a product is good, which is better, or wants opinions.",
        "parameters": {"type": "object", "properties": {"product_id": {"type": "string"}}, "required": ["product_id"]}}},
    {"type": "function", "function": {
        "name": "ask_user",
        "description": "Ask the user ONE short clarifying question with 2-5 tappable answers. Use only when the need is genuinely ambiguous (use-case, budget, brand). Never ask more than one question per turn.",
        "parameters": {"type": "object", "properties": {"question": {"type": "string"}, "options": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 5}}, "required": ["question", "options"]}}},
    {"type": "function", "function": {
        "name": "propose_inquiry",
        "description": "Offer to ask 1-5 shops about stock/price/hours. This does NOT send anything: the user confirms with a button. Use after find_shops when the user is ready to go or wants a current price.",
        "parameters": {"type": "object", "properties": {
            "product_id": {"type": "string"}, "shop_ids": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 5},
            "questions": {"type": "array", "items": {"type": "string", "enum": list(inq.QUESTIONS)}}}, "required": ["product_id", "shop_ids"]}}},
    {"type": "function", "function": {
        "name": "get_inquiry_status",
        "description": "Current status of the user's inquiries to shops (sent, seen, answered with price, out of stock, no reply) plus suggested alternatives.",
        "parameters": {"type": "object", "properties": {}}}},
]


def _p(p: dict) -> dict:
    return {"id": p["product_id"], "title": p["title"], "brand": p["brand"], "category": p["category"],
            "price_min": p["price_min"], "price_max": p["price_max"], "shops_selling": p["shop_count"]}


def _s(s: dict) -> dict:
    o = s.get("offer") or {}
    return {"shop_id": s["shop_id"], "name": s["name"], "name_is_verified": s["name_is_verified"], "tier": s["tier"],
            "mall": s["mall"], "floor": s["floor_label"], "unit": s["unit"], "area": s["area"], "km": s["distance_km"],
            "open": s["open"]["label"], "listed_price": o.get("price"), "price_age_days": o.get("age_days"),
            "price_freshness": o.get("freshness"), "price_suspicious": o.get("suspicious"),
            "installment": [p["provider"] + ("" if p["confirmed_in_store"] else " (نوع پذیرش نامشخص)") for p in s["payments"]],
            "fast_delivery": s["fast_delivery"], "warranty": o.get("warranty"),
            # fields the mentor said must not be ignored when present: shop links, the seller's own listing text
            "instagram": (s.get("instagram") or {}).get("profile_url"), "website": s.get("website"),
            "seller_listing_title": (o.get("seller_title") or "")[:90] or None,
            "seller_note": (o.get("description") or "")[:140] or None,
            "listing_warnings": [f["label"] for f in o.get("flags") or []] or None,
            "minutes": s.get("travel") and {"walk": s["travel"]["walk"], "taxi": s["travel"]["taxi"]},
            # what sellers/visitors confirmed recently (shared by all users) and how reliably the shop answers
            "confirmed": _conf(s.get("confirmation")), "reliability": (s.get("reliability") or {}).get("label")}


def _conf(c: dict | None) -> dict | None:
    if not c or c["state"] == "expired":
        return None
    return {"available": c["available"], "price": c["price"], "minutes_ago": c["age_min"], "source": c["source"]}


def _remember(ctx, items):
    seen = {x["id"] for x in ctx.memo["shown"]}
    fresh = [{"id": p["product_id"], "title": p["title"][:70], "price_min": p["price_min"], "shops": p["shop_count"]} for p in items]
    ctx.memo["shown"] = (fresh + [x for x in ctx.memo["shown"] if x["id"] not in {f["id"] for f in fresh}])[:8]
    _ = seen


class Ctx:
    def __init__(self, con, session_id: str):
        self.con, self.sid = con, session_id
        st = inq.get_session(con, session_id) or {}
        loc = st.get("location") or {}
        self.origin = (loc["lat"], loc["lon"]) if loc.get("lat") else None
        self.filters = st.get("filters") or {}
        self.memo = st.get("chat_ctx") or {"shown": [], "focus": None}  # what the user has seen; survives between turns


def run_tool(ctx: Ctx, name: str, a: dict) -> tuple[Any, dict | None]:
    con = ctx.con
    if name == "search_products":
        q, b = a.get("query", ""), {}
        _, q = split_budget(q)
        res = catalog.search_products(con, q, a.get("category"), a.get("brand"), a.get("price_min"), a.get("price_max"), limit=8)
        items = res["items"]
        _remember(ctx, items[:6])
        # stable sort: products with >=3 shops first, so the model's natural "pick the first good one" lets users compare shops
        items = sorted(items, key=lambda p: p["shop_count"] < 3)
        out = {"total": res["total"], "relaxed_match": res["relaxed"], "products": [_p(p) for p in items[:6]],
               "top_categories": [c["name"] for c in catalog.facets(con, q, a.get("category"))["categories"][:5]]}
        if not items:
            return out | {"hint": "نتیجه‌ای نبود؛ کلمهٔ کوتاه‌تر یا بودجهٔ بالاتر امتحان کنید."}, None
        return out, {"type": "product_cards", "query": q, "total": res["total"], "items": items[:4],
                     "applied": {"price_min": a.get("price_min"), "price_max": a.get("price_max")}}
    if name == "compare_products":
        ids = a.get("product_ids", [])
        if len(ids) < 2:
            return {"error": "need 2-4 product ids"}, None
        r = catalog.compare_products(con, ids)
        diff = [{"spec": x["key"], "values": x["values"]} for x in r["rows"] if x["differs"]][:12]
        return {"products": [_p(p) for p in r["products"]], "differing_specs": diff}, {"type": "comparison_table", "products": r["products"], "rows": r["rows"][:14]}
    if name == "find_shops":
        ctx.memo["focus"] = a["product_id"]
        from ..services import discover
        when = a.get("when") or "now"
        at, when_label = discover.arrival_time(when)
        r = catalog.find_shops(con, [a["product_id"]], ctx.origin, a.get("radius_km"), bool(a.get("installment")), None,
                               bool(a.get("open_now")), bool(a.get("fast_delivery")), a.get("price_max"), True, a.get("sort", "best"), 8,
                               at=None if when == "now" else at, weights=discover.PRIORITIES.get(a.get("priority") or "balanced"))
        prod = catalog.get_product(con, a["product_id"])
        fp = discover.fair_price(con, a["product_id"])
        out = {"product": prod and prod["title"], "counts": r["counts"], "listed_shops": [_s(s) for s in r["listed"][:5]],
               "category_only_example_count": r["counts"]["category_only"], "opening_judged_for": when_label,
               "best_places_to_go": [{"name": z["name"], "why": z["why"]} for z in r["zones"][:2]],
               "typical_price": fp and fp["note"]}
        if not r["listed"]:
            out["hint"] = "هیچ فروشگاهی این کالا را ثبت نکرده؛ similar_products یا فروشگاه‌های هم‌دسته (باید پرسید) را پیشنهاد دهید."
        return out, {"type": "shop_list", "product": prod and {k: prod[k] for k in ("product_id", "title", "image")}, "listed": r["listed"][:5],
                     "category_only": r["category_only"][:3], "counts": r["counts"]}
    if name == "similar_products":
        items = catalog.similar_products(con, a["product_id"], 5)
        _remember(ctx, items)
        return {"products": [_p(p) for p in items]}, ({"type": "product_cards", "query": "", "total": len(items), "items": items[:4], "applied": {}, "title": "گزینه‌های مشابه"} if items else None)
    if name == "where_to_look":
        r = catalog.where_to_look(con, a.get("query", ""), None, ctx.origin)
        hint = (a.get("knowledge_hint") or "").strip()[:120] or None
        out = {"confidence": r["confidence"], "matched_categories": [c["name"] for c in r["matched_categories"]],
               "dataset_shops_in_category": r["dataset_shops"],
               "places": [{"name": p["name"], "area": p["area"], "shops": p["shop_count"], "floors": p["common_floors"],
                           "km": p["distance_km"]} for p in r["places"]],
               "note": "confidence low/none = the dataset barely covers this category; say so and rely on knowledge_hint (label it unverified)"}
        block = {"type": "location_widget", "query": a.get("query", ""), "confidence": r["confidence"],
                 "matched_categories": r["matched_categories"], "places": r["places"], "dataset_shops": r["dataset_shops"],
                 "knowledge_hint": hint, "search_link": catalog.maps_search_link(hint) if hint else None}
        return out, block
    if name == "ask_user":
        return {"shown_to_user": True, "note": "Stop and wait for the user's tap."}, {"type": "chips", "question": a["question"], "options": a["options"][:5]}
    if name == "propose_inquiry":
        prod = catalog.get_product(con, a["product_id"])
        shops = [catalog.get_shop(con, s, ctx.origin) for s in a.get("shop_ids", [])[:5]]
        shops = [s for s in shops if s]
        qs = [k for k in a.get("questions") or ["stock", "price"] if k in inq.QUESTIONS]
        return {"shown_to_user": True, "note": "Nothing was sent; the user must tap to confirm."}, {
            "type": "inquiry_proposal", "product": prod and {k: prod[k] for k in ("product_id", "title", "image")},
            "shops": [{k: s[k] for k in ("shop_id", "name", "mall", "floor_label", "unit", "area")} for s in shops],
            "questions": [{"key": k, "text": inq.QUESTIONS[k]} for k in qs]}
    if name == "get_inquiry_status":
        items = [i for i in inq.list_for_session(con, ctx.sid) if i["kind"] == "ask"][:6]
        brief = [{"shop": i["shop"] and i["shop"]["name"], "kind": i["kind"], "status": i["label"],
                  "summary": (i["answer"] or {}).get("summary"), "price": (i["answer"] or {}).get("price"),
                  "hold_code": (i["answer"] or {}).get("hold_code"), "price_note": ((i["answer"] or {}).get("drift") or {}).get("summary"),
                  "alternatives": (i.get("alternatives") or {}).get("kind")} for i in items]
        return {"inquiries": brief}, ({"type": "inquiry_status", "items": items} if items else None)
    return {"error": f"unknown tool {name}"}, None


async def run_tool_async(ctx: Ctx, name: str, a: dict, llm=None) -> tuple[Any, dict | None]:
    """Async-aware dispatcher: tools that call the LLM (review) are awaited; the rest run synchronously."""
    if name == "product_review":
        from ..services import review
        from .llm import OpenAICompatLLM
        r = await review.build(ctx.con, a.get("product_id", ""), llm or OpenAICompatLLM())
        if r is None:
            return {"error": "product not found"}, None
        return ({"pros": [x["text"] for x in r["pros"]], "cons": [x["text"] for x in r["cons"]], "tips": r["tips"],
                 "reputation_unverified": r["reputation"] and r["reputation"]["text"], "key_specs": r["key_specs"][:4]},
                {"type": "review", **r})
    return run_tool(ctx, name, a)
