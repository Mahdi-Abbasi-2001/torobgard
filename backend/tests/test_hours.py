from datetime import datetime
from app.services.hours import open_state, TEHRAN, hours_quality

H = {d: {"shifts": [{"start_time": "10:00:00", "end_time": "19:00:00"}], "status": "declared"} for d in ["mon","tue","wed","sat","sun"]}
H["thu"] = {"shifts": [{"start_time": "10:00:00", "end_time": "14:00:00"}], "status": "declared"}
H["fri"] = {"shifts": [{"start_time": "00:00:00", "end_time": "00:00:00"}], "status": "closed"}

def at(y, m, d, hh, mm): return datetime(y, m, d, hh, mm, tzinfo=TEHRAN)

def test_open():  # 2026-10-21 is Wednesday
    assert open_state(H, at(2026,10,21,12,0)).state == "open"
def test_closing_soon():
    assert open_state(H, at(2026,10,21,18,30)).state == "closing_soon"
def test_closed_next_day():
    s = open_state(H, at(2026,10,21,20,0)); assert s.state == "closed" and "فردا" in s.label
def test_friday_goes_to_saturday():
    s = open_state(H, at(2026,10,23,12,0)); assert s.state == "closed" and "فردا" in s.label
def test_missing():
    assert open_state(None).state == "unknown" and open_state({}).state == "unknown"
def test_quality():
    assert hours_quality(H) == "ok"
