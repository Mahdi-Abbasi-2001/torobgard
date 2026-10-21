"""Short product review without review data. Honest by construction:
- pros/cons are only kept if they cite a spec key that really exists on the product (grounded in Torob's data);
- the optional "reputation" line is the model's general knowledge: labelled unverified, never carries ratings/counts;
- results are cached per product, and generation has a daily cap, so cost stays bounded."""
from __future__ import annotations
import json
import os
from datetime import datetime, timezone

from . import catalog

DAILY_CAP = int(os.environ.get("TOROB_REVIEW_DAILY_CAP", "300"))
_spent = {"day": "", "n": 0}

PROMPT = """You write a SHORT, honest buying note in Persian for a shopper in a Tehran bazaar. You receive one product with its real
specs. Reply with JSON only:
{"pros":[{"text":"...","spec_key":"<exact key from the specs>"}],"cons":[{"text":"...","spec_key":"<exact key>"}],
 "tips":["..."],"reputation":{"text":"...","confidence":"high|medium|low"} | null}
Rules:
- pros/cons: max 3 each, each MUST be justified by one spec and carry that spec's exact key; if a spec does not support it, omit it. No invented numbers.
- tips: max 3 practical things to check IN THE SHOP for this kind of product (warranty sticker, serial/IMEI, packaging, test power...). Generic is fine.
- reputation: ONLY if the brand/model is well known and you are confident; one sentence of general reputation. NEVER invent ratings, review counts, prices or awards. If unsure use null.
- Persian, plain text, no markdown. Be concise."""


def _spec_list(specs: list[dict], limit: int = 40) -> list[dict]:
    seen, out = set(), []
    for s in specs:
        k, v = (s.get("key") or "").strip(), (s.get("value") or "").strip()
        if k and v and k not in seen and len(v) < 120:
            seen.add(k); out.append({"key": k, "value": v})
    return out[:limit]


def key_specs(specs: list[dict], n: int = 6) -> list[dict]:
    skip = ("نام محصول", "شرکت سازنده", "برند")
    return [s for s in _spec_list(specs) if not any(x in s["key"] for x in skip)][:n]


def _budget_ok() -> bool:
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if _spent["day"] != day:
        _spent.update(day=day, n=0)
    return _spent["n"] < DAILY_CAP


def validate(raw: dict, specs: list[dict]) -> dict:
    """Drop anything not grounded; this is what makes the card trustworthy."""
    keys = {s["key"]: s["value"] for s in _spec_list(specs, 200)}
    def keep(items):
        out = []
        for it in (items or [])[:3]:
            if isinstance(it, dict) and it.get("spec_key") in keys and str(it.get("text") or "").strip():
                out.append({"text": str(it["text"]).strip()[:160], "spec_key": it["spec_key"], "spec_value": keys[it["spec_key"]]})
        return out
    rep = raw.get("reputation")
    if not (isinstance(rep, dict) and rep.get("confidence") in ("high", "medium") and str(rep.get("text") or "").strip()):
        rep = None
    else:
        rep = {"text": str(rep["text"]).strip()[:220], "confidence": rep["confidence"], "source": "general_knowledge", "verified": False}
    tips = [str(t).strip()[:140] for t in (raw.get("tips") or [])[:3] if str(t).strip()]
    return {"pros": keep(raw.get("pros")), "cons": keep(raw.get("cons")), "tips": tips, "reputation": rep}


async def build(con, product_id: str, llm) -> dict | None:
    p = catalog.get_product(con, product_id)
    if not p:
        return None
    row = con.execute("SELECT data, model, created_at FROM product_reviews WHERE product_id=?", (product_id,)).fetchone()
    if row:
        return {**json.loads(row[0]), "cached": True}
    base = {"product_id": product_id, "title": p["title"], "key_specs": key_specs(p["specs"]),
            "pros": [], "cons": [], "tips": [], "reputation": None, "generated_by": None, "cached": False,
            "disclaimer": "مشخصات از داده‌ی ترب است. «اطلاعات عمومی» از دانش مدل هوش مصنوعی است و تأیید نشده."}
    if not (llm and getattr(llm, "configured", False)) or not p["specs"] or not _budget_ok():
        return base  # no LLM / no specs / over budget: still useful (key specs), and not cached so it can improve later
    user = json.dumps({"title": p["title"], "brand": p["brand"], "category": p["category"], "specs": _spec_list(p["specs"])}, ensure_ascii=False)
    text = ""
    try:
        async for kind, val in llm.stream([{"role": "system", "content": PROMPT}, {"role": "user", "content": user}], None, json_mode=True):
            if kind == "text":
                text += val
        raw = json.loads(text)
    except Exception:
        return base
    _spent["n"] += 1
    out = {**base, **validate(raw, p["specs"]), "generated_by": llm.s["model"] if hasattr(llm, "s") else "llm"}
    con.execute("INSERT OR REPLACE INTO product_reviews(product_id,data,model,created_at) VALUES(?,?,?,?)",
                (product_id, json.dumps(out, ensure_ascii=False), out["generated_by"], datetime.now(timezone.utc).isoformat()))
    con.commit()
    return out
