import time
from fastapi.testclient import TestClient
from app import db, main


def test_cache_is_rewarmed_periodically(monkeypatch):
    """After a long idle the host evicts cached pages; the app must keep re-reading its hot tables."""
    calls = []
    monkeypatch.setattr(db, "warm_cache", lambda path=None: calls.append(time.time()) or 0.0)
    monkeypatch.setattr(main, "WARM_INTERVAL", 0.05)
    with TestClient(main.app):
        time.sleep(0.4)
    assert len(calls) >= 3, calls  # once at startup + repeatedly afterwards
