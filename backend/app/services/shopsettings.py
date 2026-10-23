"""What a shop owner controls from the seller app's Shop tab: «we're closed» (for today or a few hours). It overrides the opening hours
shoppers see, so nobody is sent to a shut door. Held in a small in-process map, backed by the state database."""
from __future__ import annotations

from datetime import datetime, timedelta

from .hours import TEHRAN, now_tehran

_CLOSED: dict[str, str] | None = None  # shop_id → ISO time (Tehran) until which the shop says it is closed


def _load() -> dict[str, str]:
    global _CLOSED
    if _CLOSED is None:
        _CLOSED = {}
        try:
            from .. import db
            con = db.connect()
            try:
                _CLOSED = {r["shop_id"]: r["closed_until"] for r in con.execute("SELECT shop_id, closed_until FROM shop_settings WHERE closed_until IS NOT NULL")}
            finally:
                con.close()
        except Exception:
            _CLOSED = {}
    return _CLOSED


def closed_until(shop_id: str, at: datetime | None = None) -> datetime | None:
    v = _load().get(shop_id)
    if not v:
        return None
    t = datetime.fromisoformat(v)
    return t if t > (at or now_tehran()) else None


def set_closed(con, shop_id: str, hours: float | None = None, rest_of_day: bool = False) -> datetime | None:
    """hours / rest_of_day close the shop; neither reopens it. Returns the time it is closed until (None = open)."""
    until = None
    if rest_of_day:
        until = now_tehran().replace(hour=23, minute=59, second=0, microsecond=0)
    elif hours:
        until = now_tehran() + timedelta(hours=hours)
    con.execute("INSERT INTO shop_settings(shop_id, closed_until, updated_at) VALUES(?,?,?) "
                "ON CONFLICT(shop_id) DO UPDATE SET closed_until=excluded.closed_until, updated_at=excluded.updated_at",
                (shop_id, until.isoformat() if until else None, now_tehran().isoformat()))
    con.commit()
    m = _load()
    if until:
        m[shop_id] = until.isoformat()
    else:
        m.pop(shop_id, None)
    return until
