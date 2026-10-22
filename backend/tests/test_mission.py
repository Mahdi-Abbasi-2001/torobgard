"""Mission sentence parsing: slots are read by rules (no LLM), unread slots stay null."""
from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)


def parse(text):
    r = c.post("/api/mission/parse", json={"text": text})
    assert r.status_code == 200
    return r.json()


def test_full_sentence():
    r = parse("هندزفری گردنی برای ورزش، تا ۳٫۵ میلیون، نزدیک علاالدین، عصر")
    assert r["query"] == "هندزفری گردنی" and r["need"] == "ورزش"
    assert r["budget"]["max"] == 3_500_000
    assert r["place"]["kind"] == "mall" and "علاالدین" in r["place"]["label"] and r["place"]["lat"]
    assert r["when"] == "evening"
    assert r["category"]


def test_range_installment_clock():
    r = parse("یه گوشی سامسونگ ۱۰ تا ۱۵ میلیون قسطی فردا ساعت ۱۱")
    assert r["budget"] == {"min": 10_000_000, "max": 15_000_000}
    assert r["conditions"]["installment"] is True
    assert r["when"] == "11:00" and r["query"] == "گوشی سامسونگ"


def test_area_mode_and_clock_afternoon():
    r = parse("دوربین مداربسته ۴ کانال اطراف فردوسی با تاکسی")
    assert r["place"]["kind"] == "area" and r["place"]["label"] == "فردوسی" and r["mode"] == "taxi"
    assert parse("کابل شارژ ساعت ۶ با ماشین")["when"] == "18:00"


def test_plain_word_leaves_the_rest_open():
    r = parse("هندزفری")
    assert r["query"] == "هندزفری"
    assert r["budget"] is None and r["place"] is None and r["when"] is None and r["mode"] is None and r["need"] is None
