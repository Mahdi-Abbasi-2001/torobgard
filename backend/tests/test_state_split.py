"""Production layout: read-only catalog file + separate state file on a persistent disk."""
import os, subprocess, sys, sqlite3, textwrap
from pathlib import Path
from app import db

def test_state_lives_in_attached_db_and_catalog_stays_untouched(tmp_path):
    cat, st = tmp_path / "catalog.db", tmp_path / "disk" / "state.db"
    con = sqlite3.connect(cat); con.executescript(db.CATALOG_SCHEMA); con.commit(); con.close()
    code = textwrap.dedent("""
        from app import db
        from app.services import inquiries as inq
        con = db.connect()
        inq.save_session(con, "s1", {"x": 1})
        assert inq.get_session(con, "s1") == {"x": 1}
        con.execute("INSERT INTO inquiries(id,session_id,shop_id,status) VALUES('i1','s1','shop','sent')"); con.commit()
        assert con.execute("SELECT status FROM inquiries WHERE id='i1'").fetchone()[0] == "sent"
        try:
            con.execute("INSERT INTO shops(shop_id) VALUES('nope')")  # catalog must be read-only
            raise SystemExit("catalog was writable")
        except Exception as e:
            assert "readonly" in str(e).lower(), e
        print("ok")
    """)
    env = {**os.environ, "TOROB_DB": str(cat), "TOROB_STATE_DB": str(st), "TOROB_CATALOG_READONLY": "1", "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
    r = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
    assert r.returncode == 0 and "ok" in r.stdout, r.stdout + r.stderr
    names = lambda p: {x[0] for x in sqlite3.connect(p).execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"sessions", "inquiries"} <= names(st) and not ({"sessions", "inquiries"} & names(cat))
