# Torob: In-Person Shopping Assistant (StarCoach hackathon)

Plan: `docs/PLAN.md` · Design handoff: `docs/design-brief.md`, `docs/screens.md`, `docs/fixtures/` · API: `docs/api-contract.md`

## Run locally
```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # or: uv venv && uv pip install -r requirements.txt
unzip -o ../starcoach-dataset-v16-cap300-csv.zip -d ../data/raw
.venv/bin/python -m app.ingest.build        # ~90 s → data/torob.db (SQLite + FTS5)
.venv/bin/uvicorn app.main:app --port 8765  # docs at /docs
.venv/bin/python -m pytest -q
.venv/bin/python -m app.ingest.fixtures      # regenerate docs/fixtures + openapi.json
```
Frontend (Next.js, mobile RTL UI from `design/`):
```bash
cd frontend && npm install && npm run dev   # http://localhost:3000, proxies /api to :8765
```
See `frontend/README.md` for routes and what is not wired yet.

Storage is a single SQLite file (FTS5 for Persian search). Deliberate: no extra services to run or break on Liara; 226k products search in ~10 ms.
