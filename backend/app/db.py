import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("TOROB_DB", Path(__file__).resolve().parents[2] / "data" / "torob.db"))

SCHEMA = """
PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS shops(
  shop_id TEXT PRIMARY KEY, name TEXT, is_real_name INTEGER, address TEXT, location_label TEXT,
  lat REAL, lon REAL, mall TEXT, mall_key TEXT, floor INTEGER, floor_label TEXT, unit TEXT, plaque TEXT,
  categories TEXT, contacts TEXT, instagram TEXT, website TEXT, fast_delivery INTEGER,
  hours TEXT, hours_quality TEXT, in_traffic_zone INTEGER, offer_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS shop_categories(shop_id TEXT, category TEXT);
CREATE TABLE IF NOT EXISTS shop_payments(shop_id TEXT, provider TEXT, channel TEXT);
CREATE TABLE IF NOT EXISTS products(
  product_id TEXT PRIMARY KEY, title TEXT, title_norm TEXT, brand TEXT, category TEXT, model TEXT,
  images TEXT, specs TEXT, offer_count INTEGER DEFAULT 0, shop_count INTEGER DEFAULT 0,
  price_min INTEGER, price_median INTEGER, price_max INTEGER);
CREATE TABLE IF NOT EXISTS offers(
  offer_id TEXT PRIMARY KEY, shop_id TEXT, product_id TEXT, seller_title TEXT, description TEXT,
  price INTEGER, changed_at TEXT, warranty TEXT, warranty_months INTEGER, outlier INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, state TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS inquiries(
  id TEXT PRIMARY KEY, session_id TEXT, shop_id TEXT, product_id TEXT, questions TEXT, status TEXT,
  token TEXT, answer TEXT, created_at TEXT, delivered_at TEXT, answered_at TEXT, deadline_at TEXT);
"""
INDEXES = """
CREATE INDEX IF NOT EXISTS ix_offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS ix_offers_shop ON offers(shop_id);
CREATE INDEX IF NOT EXISTS ix_shops_geo ON shops(lat, lon);
CREATE INDEX IF NOT EXISTS ix_shops_mall ON shops(mall_key);
CREATE INDEX IF NOT EXISTS ix_shopcat_cat ON shop_categories(category);
CREATE INDEX IF NOT EXISTS ix_shopcat_shop ON shop_categories(shop_id);
CREATE INDEX IF NOT EXISTS ix_pay_shop ON shop_payments(shop_id);
CREATE INDEX IF NOT EXISTS ix_prod_cat ON products(category);
CREATE INDEX IF NOT EXISTS ix_prod_brand ON products(brand);
CREATE INDEX IF NOT EXISTS ix_inq_session ON inquiries(session_id);
CREATE INDEX IF NOT EXISTS ix_inq_token ON inquiries(token);
"""


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    con = sqlite3.connect(str(path or DB_PATH), check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con
