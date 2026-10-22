import os, uuid
os.environ["TOROB_SIMULATE_SELLERS"] = "0"
from fastapi.testclient import TestClient
from app.main import app
from app.services import auth

SHOP = "shop_c060bc5ea37b78e00ece4bdb"
PID = "product_24e20485148d72cb2f46305d"


def _name():
    return "t_" + uuid.uuid4().hex[:10]


def test_password_hash_roundtrip():
    h = auth.hash_password("correct horse")
    assert h.startswith("scrypt$") and "correct" not in h
    assert auth.check_password("correct horse", h) and not auth.check_password("wrong horse!", h)


def test_signup_adopts_anonymous_session_and_guards_it():
    with TestClient(app) as c:
        anon = str(uuid.uuid4())
        c.post("/api/inquiries", json={"session_id": anon, "shop_ids": [SHOP], "product_id": PID})
        name = _name()
        r = c.post("/api/auth/signup", json={"username": name, "password": "longenough1", "session_id": anon})
        assert r.status_code == 200, r.text
        tok, user = r.json()["token"], r.json()["user"]
        assert user["session_id"] == anon and user["username"] == name
        # the account's session is now private: no token → 401, wrong token → 401, own token → data
        assert c.get(f"/api/sessions/{anon}/inquiries").status_code == 401
        other = c.post("/api/auth/signup", json={"username": _name(), "password": "longenough2"}).json()["token"]
        assert c.get(f"/api/sessions/{anon}/inquiries", headers={"Authorization": f"Bearer {other}"}).status_code == 401
        mine = c.get(f"/api/sessions/{anon}/inquiries", headers={"Authorization": f"Bearer {tok}"})
        assert mine.status_code == 200 and len(mine.json()["items"]) == 1
        assert c.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()["user"]["id"] == user["id"]


def test_duplicate_username_and_validation():
    with TestClient(app) as c:
        name = _name()
        assert c.post("/api/auth/signup", json={"username": name, "password": "longenough1"}).status_code == 200
        assert c.post("/api/auth/signup", json={"username": name.upper(), "password": "longenough1"}).status_code == 409
        assert c.post("/api/auth/signup", json={"username": "ab", "password": "longenough1"}).status_code == 400
        assert c.post("/api/auth/signup", json={"username": _name(), "password": "short"}).status_code == 400


def test_login_merges_device_inquiries_and_logout_revokes():
    with TestClient(app) as c:
        name = _name()
        r = c.post("/api/auth/signup", json={"username": name, "password": "longenough1"}).json()
        account_sid = r["user"]["session_id"]
        device = str(uuid.uuid4())
        c.post("/api/inquiries", json={"session_id": device, "shop_ids": [SHOP], "product_id": PID})
        bad = c.post("/api/auth/login", json={"username": name, "password": "nope-nope"})
        assert bad.status_code == 401
        ok = c.post("/api/auth/login", json={"username": name, "password": "longenough1", "session_id": device}).json()
        h = {"Authorization": f"Bearer {ok['token']}"}
        assert len(c.get(f"/api/sessions/{account_sid}/inquiries", headers=h).json()["items"]) == 1
        c.post("/api/auth/logout", headers=h)
        assert c.get("/api/auth/me", headers=h).status_code == 401


def test_anonymous_sessions_unchanged():
    with TestClient(app) as c:
        sid = str(uuid.uuid4())
        assert c.put(f"/api/sessions/{sid}", json={"state": {"x": 1}}).status_code == 200
        assert c.get(f"/api/sessions/{sid}").json()["x"] == 1
