import os
os.environ["TOROB_SIMULATE_SELLERS"] = "0"
from app import db
from app.services import catalog, inquiries as inq


def test_alternatives_never_empty_just_because_everything_is_closed(monkeypatch):
    """Regression: at night all shops are closed, and alternatives used to come back empty."""
    con = db.connect()
    pid = next(p for p in catalog.search_products(con, "هندزفری", limit=60)["items"] if p["shop_count"] >= 3)["product_id"]
    real = catalog.find_shops
    def all_closed(*a, **k):
        r = real(*a, **k)
        for s in r["listed"]:
            s["open"] = {**s["open"], "state": "closed", "label": "بسته است"}
        return r
    monkeypatch.setattr(catalog, "find_shops", all_closed)
    alt = inq.alternatives(con, "night-test", pid, k=3)
    assert alt["shops"], "closed shops must still be offered (labelled closed) when no shop is open"
