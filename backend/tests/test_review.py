import asyncio, json, os
os.environ["TOROB_SIMULATE_SELLERS"] = "0"
from app import db
from app.services import catalog, review


class FakeLLM:
    configured = True
    s = {"model": "fake"}
    def __init__(self, payload): self.payload, self.calls = payload, 0
    async def stream(self, messages, tools=None, json_mode=False):
        assert json_mode, "review must request JSON"
        self.calls += 1
        yield "text", json.dumps(self.payload, ensure_ascii=False)


def _product(con):
    for p in catalog.search_products(con, "هدفون", limit=40)["items"]:
        d = catalog.get_product(con, p["product_id"])
        if len(d["specs"]) >= 6:
            return d
    raise AssertionError("need a product with specs")


def test_ungrounded_claims_are_dropped_and_reputation_is_labelled(monkeypatch):
    con = db.connect()
    con.execute("DELETE FROM product_reviews")
    d = _product(con)
    real_key = d["specs"][0]["key"]
    llm = FakeLLM({"pros": [{"text": "grounded", "spec_key": real_key}, {"text": "invented", "spec_key": "کلید ساختگی"}],
                   "cons": [{"text": "no key at all"}], "tips": ["گارانتی را چک کنید"],
                   "reputation": {"text": "برند شناخته‌شده", "confidence": "high"}})
    r = asyncio.run(review.build(con, d["product_id"], llm))
    assert [x["text"] for x in r["pros"]] == ["grounded"], "a pro citing a non-existent spec must be dropped"
    assert r["cons"] == [], "a con without a spec_key must be dropped"
    assert r["reputation"]["verified"] is False and r["reputation"]["source"] == "general_knowledge"
    assert r["disclaimer"] and r["key_specs"]


def test_low_confidence_reputation_is_removed_and_result_is_cached():
    con = db.connect()
    con.execute("DELETE FROM product_reviews")
    d = _product(con)
    llm = FakeLLM({"pros": [], "cons": [], "tips": [], "reputation": {"text": "نمی‌دانم", "confidence": "low"}})
    r1 = asyncio.run(review.build(con, d["product_id"], llm))
    r2 = asyncio.run(review.build(con, d["product_id"], llm))
    assert r1["reputation"] is None
    assert r2["cached"] is True and llm.calls == 1, "second request must come from the cache (no second LLM call)"


def test_without_llm_still_returns_key_specs_and_is_not_cached():
    con = db.connect()
    con.execute("DELETE FROM product_reviews")
    d = _product(con)
    class NoLLM: configured = False
    r = asyncio.run(review.build(con, d["product_id"], NoLLM()))
    assert r["key_specs"] and r["pros"] == [] and r["generated_by"] is None
    assert con.execute("SELECT COUNT(*) FROM product_reviews").fetchone()[0] == 0
