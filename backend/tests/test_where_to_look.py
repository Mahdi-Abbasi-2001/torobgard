from app import db
from app.services import catalog as c


def test_known_category_returns_real_clusters():
    con = db.connect()
    r = c.where_to_look(con, "لوستر")
    assert r["confidence"] == "high" and r["places"]
    assert r["places"][0]["shop_count"] >= r["places"][-1]["shop_count"] or r["places"][0]["kind"] == "mall"
    assert all(p["links"]["neshan"].startswith("https://nshn.ir") for p in r["places"])


def test_word_boundary_no_substring_matches():
    """«لباس» must not match «کالباس بر» (deli meat): matches must start at a word boundary."""
    cats, _ = c.match_categories(db.connect(), "لباس")
    assert cats and not any("کالباس" in x["name"] for x in cats)


def test_spacing_variants_match():
    cats, conf = c.match_categories(db.connect(), "دوربین مداربسته")
    assert conf == "high" and any("مدار بسته" in x["name"] for x in cats)


def test_weak_coverage_is_reported_as_weak():
    _, conf = c.match_categories(db.connect(), "کفش کتونی")
    assert conf in ("low", "none"), "the shop data is electronics-heavy: sneakers must not look well covered"


def test_endpoint_and_maps_link():
    import os
    os.environ["TOROB_SIMULATE_SELLERS"] = "0"
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as cl:
        r = cl.get("/api/where-to-look", params={"q": "گوشی موبایل", "hint": "بازار موبایل تهران"}).json()
        assert r["places"] and r["search_link"].startswith("https://www.google.com/maps/search/")
