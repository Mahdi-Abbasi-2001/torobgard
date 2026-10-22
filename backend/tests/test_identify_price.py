from app.services.identify import _price_from_text


def test_toman_tag_kept_as_is():
    assert _price_from_text("۳،۲۰۰،۰۰۰ تومان") == 3_200_000
    assert _price_from_text("۳٬۲۰۰٬۰۰۰") == 3_200_000
    assert _price_from_text("3,200,000 Toman") == 3_200_000


def test_rial_and_thousand():
    assert _price_from_text("۳۲٬۰۰۰٬۰۰۰ ریال") == 3_200_000
    assert _price_from_text("۸۵۰ هزار تومان") == 850_000


def test_nothing_readable():
    assert _price_from_text(None) is None
    assert _price_from_text("تماس بگیرید") is None


# --- matching what was read to catalogue products (real catalogue) ---
from app import db
from app.services.identify import candidates


def test_model_words_match_whole_words_only():
    """A «SMART TECH» pen must not match Audio-Technica microphones; fall back to Panter pens."""
    items, _, match = candidates(db.connect(), {"brand": "Panter", "brand_fa": "پنتر", "model": "SMART TECH",
                                                "product_type": "خودکار", "search_query": "خودکار پنتر SMART TECH"})
    assert match == "type_only" and items
    assert not any("technica" in p["title"].lower() for p in items)
    assert all("خودکار" in p["title"] for p in items)


def test_exact_and_parts_still_work():
    con = db.connect()
    _, _, m = candidates(con, {"brand": "soundcore", "model": "Life U2i (Upgraded)", "product_type": "هندزفری گردنی"})
    assert m == "exact"
    _, _, m = candidates(con, {"brand": "Samsung", "brand_fa": "سامسونگ", "model": "Galaxy A15", "product_type": "گوشی موبایل"})
    assert m == "related"  # only cases and parts of the A15 are listed, not the phone


def test_generic_model_word_alone_is_not_a_match():
    """«NANO BACTERIOBOD+» pen: «nano» alone must not pull DJI Osmo Nano / Anker Nano accessories; and «اپراتور خودکار»
    (automatic telephone operator) is not a pen."""
    items, _, match = candidates(db.connect(), {"brand": "Dr. Penker", "brand_fa": "دکتر پنکر", "model": "NANO BACTERIOBOD+",
                                                "product_type": "خودکار", "search_query": "خودکار دکتر پنکر NANO BACTERIOBOD+"})
    assert match == "type_only" and items
    assert all(p["title"].startswith("خودکار") for p in items)
