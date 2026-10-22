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
