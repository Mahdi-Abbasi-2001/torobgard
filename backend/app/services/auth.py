"""Optional user accounts: username + password.

- Passwords: scrypt (stdlib hashlib), per-user random salt; never stored or logged in clear.
- Login tokens: random 256-bit, stored only as SHA-256; expire after TOKEN_DAYS.
- Each user owns one shopping session (inquiries, chat memory, filters). On signup the visitor's anonymous session becomes
  the account's session; on login, the anonymous session's inquiries are moved into the account.
- A session that belongs to a user can only be read or written with that user's token (see `guard`). Anonymous sessions
  keep working as before: their random id is the only key.
"""
from __future__ import annotations
import hashlib
import hmac
import re
import secrets
import time
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone

TOKEN_DAYS = 30
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}
_USERNAME = re.compile(r"^[\w.\-]{3,32}$")  # \w is Unicode-aware: Persian letters and digits are allowed
_FAILS: dict[str, list[float]] = {}  # username/IP → recent failed login timestamps (in-process; single-instance deploy)
FAIL_WINDOW_S, FAIL_MAX = 15 * 60, 8


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def _now() -> datetime:
    return datetime.now(timezone.utc)


def norm_username(u: str) -> str:
    u = unicodedata.normalize("NFKC", (u or "").strip()).replace("ي", "ی").replace("ك", "ک")
    return u.lower()


def validate(username: str, password: str):
    u = norm_username(username)
    if not _USERNAME.match(u):
        raise AuthError(400, "نام کاربری باید ۳ تا ۳۲ حرف باشد و فقط حرف، عدد، نقطه، خط تیره یا زیرخط داشته باشد.")
    if not (8 <= len(password or "") <= 128):
        raise AuthError(400, "رمز عبور باید دست‌کم ۸ حرف باشد.")
    return u


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${h.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, h = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(h) // 2)
        return hmac.compare_digest(got.hex(), h)
    except (ValueError, TypeError):
        return False


def _throttled(keys: list[str]) -> bool:
    t = time.monotonic()
    for k in keys:
        _FAILS[k] = [x for x in _FAILS.get(k, []) if t - x < FAIL_WINDOW_S]
    return any(len(_FAILS[k]) >= FAIL_MAX for k in keys)


def _fail(keys: list[str]):
    for k in keys:
        _FAILS.setdefault(k, []).append(time.monotonic())


def _issue_token(con, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    con.execute("INSERT INTO auth_tokens(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), user_id, _now().isoformat(), (_now() + timedelta(days=TOKEN_DAYS)).isoformat()))
    con.commit()
    return token


def _public(row, con=None) -> dict:
    role = (row["role"] if "role" in row.keys() else None) or "shopper"
    shop = None
    if role == "seller" and con is not None:
        r = con.execute("SELECT shop_id FROM seller_shops WHERE user_id=?", (row["id"],)).fetchone()
        shop = r["shop_id"] if r else None
    return {"id": row["id"], "username": row["username"], "session_id": row["session_id"], "role": role, "shop_id": shop}


def session_owner(con, session_id: str) -> str | None:
    r = con.execute("SELECT id FROM users WHERE session_id=?", (session_id,)).fetchone()
    return r["id"] if r else None


def signup(con, username: str, password: str, anon_session: str | None) -> tuple[dict, str]:
    u = validate(username, password)
    if con.execute("SELECT 1 FROM users WHERE username_norm=?", (u,)).fetchone():
        raise AuthError(409, "این نام کاربری قبلاً گرفته شده است.")
    # adopt the visitor's anonymous session (their inquiries so far) unless it already belongs to someone
    sid = anon_session if anon_session and len(anon_session) <= 64 and not session_owner(con, anon_session) else str(uuid.uuid4())
    uid = "usr_" + uuid.uuid4().hex[:16]
    con.execute("INSERT INTO users(id,username,username_norm,pw,session_id,created_at) VALUES(?,?,?,?,?,?)",
                (uid, (username or "").strip(), u, hash_password(password), sid, _now().isoformat()))
    con.commit()
    row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _public(row, con), _issue_token(con, uid)


def signup_seller(con, username: str, password: str, shop_id: str) -> tuple[dict, str]:
    """A shop owner's account. The caller has already checked the shop code; one account per shop."""
    u = validate(username, password)
    if con.execute("SELECT 1 FROM users WHERE username_norm=?", (u,)).fetchone():
        raise AuthError(409, "این نام کاربری قبلاً گرفته شده است.")
    if con.execute("SELECT 1 FROM seller_shops WHERE shop_id=?", (shop_id,)).fetchone():
        raise AuthError(409, "این فروشگاه قبلاً حساب دارد؛ وارد شوید.")
    uid = "usr_" + uuid.uuid4().hex[:16]
    con.execute("INSERT INTO users(id,username,username_norm,pw,session_id,created_at,role) VALUES(?,?,?,?,?,?,'seller')",
                (uid, (username or "").strip(), u, hash_password(password), str(uuid.uuid4()), _now().isoformat()))
    con.execute("INSERT INTO seller_shops(shop_id,user_id,created_at) VALUES(?,?,?)", (shop_id, uid, _now().isoformat()))
    con.commit()
    row = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return _public(row, con), _issue_token(con, uid)


def login(con, username: str, password: str, anon_session: str | None, ip: str) -> tuple[dict, str]:
    u = norm_username(username)
    keys = [f"u:{u}", f"ip:{ip}"]
    if _throttled(keys):
        raise AuthError(429, "تلاش‌های ناموفق زیاد بود. چند دقیقه بعد دوباره امتحان کنید.")
    row = con.execute("SELECT * FROM users WHERE username_norm=?", (u,)).fetchone()
    if not row or not check_password(password or "", row["pw"]):
        if not row:
            hash_password(password or "x")  # spend the same time whether or not the user exists
        _fail(keys)
        raise AuthError(401, "نام کاربری یا رمز عبور درست نیست.")
    _FAILS.pop(f"u:{u}", None)
    # bring along what this device did before logging in
    if (row["role"] if "role" in row.keys() else None) != "seller" and anon_session and anon_session != row["session_id"] and not session_owner(con, anon_session):
        con.execute("UPDATE inquiries SET session_id=? WHERE session_id=?", (row["session_id"], anon_session))
        con.commit()
    return _public(row, con), _issue_token(con, row["id"])


def user_for_token(con, token: str | None) -> dict | None:
    if not token:
        return None
    r = con.execute("SELECT u.* , t.expires_at FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=?",
                    (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not r or r["expires_at"] < _now().isoformat():
        return None
    return _public(r, con)


def logout(con, token: str | None):
    if token:
        con.execute("DELETE FROM auth_tokens WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        con.commit()


def guard(con, session_id: str, token: str | None):
    """A user's session needs that user's token; anonymous sessions stay open to whoever holds their random id."""
    owner = session_owner(con, session_id)
    if owner is None:
        return
    u = user_for_token(con, token)
    if not u or u["id"] != owner:
        raise AuthError(401, "برای دیدن این خریدها وارد حساب خود شوید.")
