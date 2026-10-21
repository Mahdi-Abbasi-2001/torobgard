from app import db
from app.services import catalog as c


def test_instagram_is_an_object_not_a_json_string():
    con = db.connect()
    sid = con.execute("SELECT shop_id FROM shops WHERE instagram IS NOT NULL AND offer_count>0 LIMIT 1").fetchone()[0]
    shop = c.get_shop(con, sid)
    assert isinstance(shop["instagram"], dict) and shop["instagram"]["profile_url"].startswith("https://www.instagram.com/")
    assert shop["instagram"]["handle"]


def test_shops_without_links_have_none():
    con = db.connect()
    sid = con.execute("SELECT shop_id FROM shops WHERE instagram IS NULL AND website IS NULL LIMIT 1").fetchone()[0]
    shop = c.get_shop(con, sid)
    assert shop["instagram"] is None and shop["website"] is None
