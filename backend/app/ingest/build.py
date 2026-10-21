"""Build the SQLite database from the Torob CSV dump.  Usage: python -m app.ingest.build [data_dir]"""
import csv
import json
import re
import statistics
import sys
import time
from pathlib import Path

from app import db
from app.services.address import mall_key, parse_address
from app.services.geo import in_traffic_zone
from app.services.hours import hours_quality, parse_hours_json
from app.services.text import normalize_fa

csv.field_size_limit(10**9)
ROOT = Path(__file__).resolve().parents[3]


def _j(v):
    if v in (None, "", "null"):
        return None
    try:
        return json.loads(v)
    except Exception:
        return None


def _n(v):
    return None if v in (None, "", "null") else v


def warranty_months(w: dict | None) -> int | None:
    if not w:
        return None
    if w.get("period_months"):
        return int(w["period_months"])
    d = normalize_fa(w.get("description") or "")
    m = re.search(r"(\d+)\s*(ماه|سال)", d)
    if m:
        return int(m.group(1)) * (12 if m.group(2) == "سال" else 1)
    return None


def build(data_dir: Path, out: Path):
    t0 = time.time()
    if out.exists():
        out.unlink()
    out.parent.mkdir(parents=True, exist_ok=True)
    con = db.connect(out)
    con.executescript(db.SCHEMA)

    # ---- shops
    shops = []
    with open(data_dir / "shops.csv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            cats = _j(r["category_names"]) or []
            pa = parse_address(r["address"])
            hrs = parse_hours_json(r["weekly_hours"])
            lat = float(r["lat"]) if _n(r["lat"]) else None
            lon = float(r["lon"]) if _n(r["lon"]) else None
            fd = {"true": 1, "false": 0}.get(r["supports_fast_delivery"])
            real = 1 if (_n(r["instagram"]) or _n(r["website_url"])) else 0
            shops.append((r["shop_id"], r["name"], real, r["address"], _n(r["location_label"]), lat, lon,
                          pa.mall, mall_key(pa.mall), pa.floor, pa.floor_label, pa.unit, pa.plaque,
                          json.dumps(cats, ensure_ascii=False), r["contacts"], _n(r["instagram"]),
                          _n(r["website_url"]), fd, json.dumps(hrs, ensure_ascii=False) if hrs else None,
                          hours_quality(hrs), int(in_traffic_zone(lat, lon))))
            for c in set(cats):
                con.execute("INSERT INTO shop_categories VALUES(?,?)", (r["shop_id"], c))
            for p in _j(r["payment_options"]) or []:
                con.execute("INSERT INTO shop_payments VALUES(?,?,?)",
                            (r["shop_id"], p.get("provider_name"), p.get("channel")))
    con.executemany("INSERT INTO shops(shop_id,name,is_real_name,address,location_label,lat,lon,mall,mall_key,floor,"
                    "floor_label,unit,plaque,categories,contacts,instagram,website,fast_delivery,hours,hours_quality,"
                    "in_traffic_zone) VALUES(" + ",".join("?" * 21) + ")", shops)
    print(f"shops {len(shops)}  {time.time()-t0:.0f}s")

    # ---- offers
    rows = []
    with open(data_dir / "offers.csv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            w = _j(r["warranty"])
            price = int(float(r["price_toman"])) if _n(r["price_toman"]) else 0
            rows.append((r["offer_id"], r["shop_id"], r["product_id"], r["seller_title"], _n(r["description"]),
                         price if price > 0 else None, _n(r["last_price_changed_at"]),
                         json.dumps(w, ensure_ascii=False) if w else None, warranty_months(w)))
    con.executemany("INSERT INTO offers(offer_id,shop_id,product_id,seller_title,description,price,changed_at,"
                    "warranty,warranty_months) VALUES(?,?,?,?,?,?,?,?,?)", rows)
    print(f"offers {len(rows)}  {time.time()-t0:.0f}s")

    # ---- products
    batch = []
    with open(data_dir / "products.csv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            imgs = (_j(r["image_urls"]) or [])[:4]
            title = r["persian_title"]
            batch.append((r["product_id"], title, normalize_fa(title), _n(r["brand_name"]), _n(r["category_name"]),
                          _n(r["model"]), json.dumps(imgs), _n(r["specs"])))
            if len(batch) >= 20000:
                con.executemany("INSERT INTO products(product_id,title,title_norm,brand,category,model,images,specs) "
                                "VALUES(?,?,?,?,?,?,?,?)", batch)
                batch.clear()
    if batch:
        con.executemany("INSERT INTO products(product_id,title,title_norm,brand,category,model,images,specs) "
                        "VALUES(?,?,?,?,?,?,?,?)", batch)
    print(f"products  {time.time()-t0:.0f}s")
    con.commit()
    con.executescript(db.INDEXES)

    # ---- derived: product price stats + outliers
    prices: dict[str, list[tuple[str, int, str]]] = {}
    for oid, pid, sid, price in con.execute("SELECT offer_id, product_id, shop_id, price FROM offers WHERE price IS NOT NULL"):
        prices.setdefault(pid, []).append((oid, price, sid))
    counts = dict(con.execute("SELECT product_id, COUNT(*) FROM offers GROUP BY product_id").fetchall())
    shopc = dict(con.execute("SELECT product_id, COUNT(DISTINCT shop_id) FROM offers GROUP BY product_id").fetchall())
    upd, outliers = [], []
    for pid, cnt in counts.items():
        ps = prices.get(pid, [])
        vals = sorted(p for _, p, _ in ps)
        if vals:
            med = int(statistics.median(vals))
            upd.append((cnt, shopc.get(pid, 0), vals[0], med, vals[-1], pid))
            if len(vals) >= 3:
                outliers += [(oid,) for oid, p, _ in ps if p < 0.4 * med or p > 2.5 * med]
        else:
            upd.append((cnt, shopc.get(pid, 0), None, None, None, pid))
    con.executemany("UPDATE products SET offer_count=?, shop_count=?, price_min=?, price_median=?, price_max=? "
                    "WHERE product_id=?", upd)
    con.executemany("UPDATE offers SET outlier=1 WHERE offer_id=?", outliers)
    con.execute("UPDATE shops SET offer_count=(SELECT COUNT(*) FROM offers o WHERE o.shop_id=shops.shop_id)")
    print(f"derived (outliers {len(outliers)})  {time.time()-t0:.0f}s")

    # ---- FTS for product search (normalized text, unicode61 tokenizer handles Persian)
    con.executescript("""
      CREATE VIRTUAL TABLE products_fts USING fts5(title_norm, brand_n, category_n, model_n, tokenize='unicode61 remove_diacritics 0', prefix='2 3');
    """)
    rows = [(rid, t, normalize_fa(b), normalize_fa(c), normalize_fa(m)) for rid, t, b, c, m in
            con.execute("SELECT rowid, title_norm, COALESCE(brand,''), COALESCE(category,''), COALESCE(model,'') FROM products")]
    con.executemany("INSERT INTO products_fts(rowid,title_norm,brand_n,category_n,model_n) VALUES(?,?,?,?,?)", rows)
    con.commit()
    con.execute("ANALYZE")
    con.commit()
    con.close()
    print(f"done in {time.time()-t0:.0f}s -> {out}  ({out.stat().st_size/1e6:.0f} MB)")


if __name__ == "__main__":
    d = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "raw"
    build(d, db.DB_PATH)
