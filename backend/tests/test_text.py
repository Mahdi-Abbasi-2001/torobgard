from app.services.text import normalize_fa, parse_budget

def test_normalize():
    assert normalize_fa("كتاب ي ۱۲۳  هندزفری‌بی‌سیم") == "کتاب ی 123 هندزفری بی سیم"

def test_budget():
    assert parse_budget("هندزفری زیر ۳ میلیون") == {"max": 3_000_000}
    assert parse_budget("گوشی بین ۱۰ تا ۱۵ میلیون") == {"min": 10_000_000, "max": 15_000_000}
    assert parse_budget("تا ۱۵ تومن") == {"max": 15_000_000}
    assert parse_budget("بالای ۲.۵ میلیون") == {"min": 2_500_000}
    assert parse_budget("هندزفری") == {}

def test_split_budget():
    from app.services.text import split_budget
    b, rest = split_budget("هندزفری بی سیم زیر ۳ میلیون")
    assert b == {"max": 3_000_000} and rest == "هندزفری بی سیم"
    assert split_budget("گوشی بین ۱۰ تا ۱۵ میلیون")[1] == "گوشی"
