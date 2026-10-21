"""SQLite access.

Catalog (shops/products/offers + FTS) is read-mostly and built by app.ingest.build.
State (sessions, inquiries) is written at runtime. In production they are separate files:
  TOROB_DB            catalog file (baked into the image; opened immutable when TOROB_CATALOG_READONLY=1)
  TOROB_STATE_DB      state file on a persistent disk, ATTACHed as `st` (unqualified table names still resolve)
Locally, with TOROB_STATE_DB unset, state tables simply live in the catalog file.
"""
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("TOROB_DB", Path(__file__).resolve().parents[2] / "data" / "torob.db"))
STATE_DB = os.environ.get("TOROB_STATE_DB")
READONLY = os.environ.get("TOROB_CATALOG_READONLY") == "1"

CATALOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS shops(
  shop_id TEXT PRIMARY KEY, name TEXT, is_real_name INTEGER, address TEXT, location_label TEXT,
  lat REAL, lon REAL, mall TEXT, mall_key TEXT, floor INTEGER, floor_label TEXT, unit TEXT, plaque TEXT,
  categories TEXT, contacts TEXT, instagram TEXT, website TEXT, fast_delivery INTEGER,
  hours TEXT, hours_quality TEXT, in_traffic_zone INTEGER, offer_count INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS shop_categories(shop_id TEXT, category TEXT);
CREATE TABLE IF NOT EXISTS shop_payments(shop_id TEXT, provider TEXT, channel TEXT);
CREATE TABLE IF NOT EXISTS products(
  product_id TEXT PRIMARY KEY, title TEXT, title_norm TEXT, brand TEXT, category TEXT, model TEXT,
  images TEXT, offer_count INTEGER DEFAULT 0, shop_count INTEGER DEFAULT 0,
  price_min INTEGER, price_median INTEGER, price_max INTEGER);
-- specs are large and only needed on product detail/compare: keeping them out of `products` keeps the hot set small
CREATE TABLE IF NOT EXISTS product_specs(product_id TEXT, specs TEXT);
CREATE TABLE IF NOT EXISTS offers(
  offer_id TEXT PRIMARY KEY, shop_id TEXT, product_id TEXT, seller_title TEXT, description TEXT,
  price INTEGER, changed_at TEXT, warranty TEXT, warranty_months INTEGER, outlier INTEGER DEFAULT 0);
"""

STATE_TABLES = """
CREATE TABLE IF NOT EXISTS {p}sessions(id TEXT PRIMARY KEY, state TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS {p}inquiries(
  id TEXT PRIMARY KEY, session_id TEXT, shop_id TEXT, product_id TEXT, questions TEXT, status TEXT,
  token TEXT, answer TEXT, created_at TEXT, delivered_at TEXT, answered_at TEXT, deadline_at TEXT);
CREATE INDEX IF NOT EXISTS {p}ix_inq_session ON inquiries(session_id);
CREATE INDEX IF NOT EXISTS {p}ix_inq_token ON inquiries(token);
"""

INDEXES = """
CREATE UNIQUE INDEX IF NOT EXISTS ix_specs_pid ON product_specs(product_id);
CREATE INDEX IF NOT EXISTS ix_offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS ix_offers_shop ON offers(shop_id);
CREATE INDEX IF NOT EXISTS ix_shops_geo ON shops(lat, lon);
CREATE INDEX IF NOT EXISTS ix_shops_mall ON shops(mall_key);
CREATE INDEX IF NOT EXISTS ix_shopcat_cat ON shop_categories(category);
CREATE INDEX IF NOT EXISTS ix_shopcat_shop ON shop_categories(shop_id);
CREATE INDEX IF NOT EXISTS ix_pay_shop ON shop_payments(shop_id);
CREATE INDEX IF NOT EXISTS ix_prod_cat ON products(category);
CREATE INDEX IF NOT EXISTS ix_prod_brand ON products(brand);
"""

SCHEMA = CATALOG_SCHEMA  # back-compat name used by the ingest


def connect(path: Path | str | None = None, state: bool = True) -> sqlite3.Connection:
    """Open the catalog and (state=True) make sure runtime state tables are reachable."""
    target = Path(path or DB_PATH)
    if READONLY and path is None:
        con = sqlite3.connect(f"file:{target}?mode=ro&immutable=1", uri=True, check_same_thread=False)
    else:
        con = sqlite3.connect(str(target), check_same_thread=False)
    con.row_factory = sqlite3.Row
    if not state:
        return con
    if STATE_DB:
        Path(STATE_DB).parent.mkdir(parents=True, exist_ok=True)
        con.execute("ATTACH DATABASE ? AS st", (STATE_DB,))
        con.execute("PRAGMA st.journal_mode=WAL")
        con.execute("PRAGMA st.synchronous=NORMAL")
        con.executescript(STATE_TABLES.format(p="st."))
    elif not READONLY:
        con.executescript(STATE_TABLES.format(p=""))
    return con


def warm_cache(path: Path | str | None = None) -> float:
    """Touch the hot tables/indexes so the first real query isn't cold. On small-RAM hosts (0.5 GB) the OS page cache is
    the only cache; specs are deliberately NOT read here. Returns seconds taken."""
    import time
    t = time.time()
    con = connect(path, state=False)
    try:
        for q in ("SELECT COUNT(*), SUM(LENGTH(title_norm)) FROM products",
                  "SELECT COUNT(*) FROM products_fts WHERE products_fts MATCH 'هندزفری*'",
                  "SELECT COUNT(*), SUM(price) FROM offers",
                  "SELECT COUNT(*) FROM offers INDEXED BY ix_offers_product WHERE product_id > ''",
                  "SELECT COUNT(*) FROM offers INDEXED BY ix_offers_shop WHERE shop_id > ''",
                  "SELECT COUNT(*), SUM(LENGTH(hours)) FROM shops",
                  "SELECT COUNT(*) FROM shop_categories INDEXED BY ix_shopcat_cat WHERE category > ''",
                  "SELECT COUNT(*) FROM shop_payments",
                  "SELECT COUNT(*) FROM products INDEXED BY ix_prod_cat WHERE category > ''"):
            con.execute(q).fetchone()
    finally:
        con.close()
    return time.time() - t
