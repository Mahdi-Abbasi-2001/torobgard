# Deploying to Liara (single app)

Product: **ترب‌گرد** · Liara app: **`torobgard`** (team `6a86b17a129b5d10d46e4dae`, plan `small-g2`, Docker).

One container runs both servers: the Next.js app on the public port 3000 and FastAPI on `127.0.0.1:8000` (private, only
reachable through Next's `/api` proxy). `deploy/start.sh` starts both and exits if either dies, so Liara restarts the
whole container instead of serving a half-dead app.

Verified locally (no Docker on the dev machine): the start script with production env, the read-only catalog + separate
state file (state survives restart), the standalone Next server and its runtime `/api` proxy incl. SSE chat streaming,
and the "one process dies -> container exits" behaviour. **Not verified locally: the Docker build itself.**

## Facts that shape the setup
- Liara only offers **Iran-region** apps and **OpenAI blocks Iranian IPs**, so the deployed chat can't use OpenAI. Use
  **BoxAPI** (OpenAI-compatible): `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`. Until set, chat runs the rule-based
  fallback (tested; UI shows the «جستجوی ساده» banner).
- Memory measured locally: backend ≈ 83 MB, Next standalone ≈ 137 MB. `small-g2` is 0.5 GB, so it should fit but with
  little headroom: if search feels slow or the app restarts, raise the plan to `medium-g2` (disk and data are kept).
- The catalog (~460 MB SQLite + FTS) is **built into the image** from `backend/dataset/dataset.zip` (~30-90 s);
  sessions and inquiries live in `/data/state.db` on a Liara **disk** named `state` (1 GB is plenty).
- One uvicorn worker on purpose (live-update bus and simulated sellers are in-process).

## One-time setup
```bash
T=6a86b17a129b5d10d46e4dae
liara disk create --app torobgard --name state --size 1 --team-id $T        # if not created yet
liara env set --app torobgard --team-id $T TOROB_SECRET=<long-random> TOROB_INQUIRY_TIMEOUT_S=300
# when BoxAPI arrives (set these yourself, never commit them):
liara env set --app torobgard --team-id $T LLM_BASE_URL=<url> LLM_API_KEY=<key> LLM_MODEL=<model>
```

## Deploy (repeat per release, from the repo root)
```bash
cp starcoach-dataset-v16-cap300-csv.zip backend/dataset/dataset.zip   # once; gitignored
liara deploy --app torobgard --team-id $T --platform docker --port 3000
```
`.liaraignore` files keep `.env`, `node_modules`, `.venv`, `.git` out of the upload. If the build can't fetch pip/npm
packages from inside Iran, add `--build-location germany`.

## Smoke test
```bash
curl https://torobgard.iran.liara.run/api/readyz         # {"ok":true,"products":225903,...}
curl https://torobgard.iran.liara.run/api/chat-status    # llm_configured true once BoxAPI vars are set
```
Then on a phone: search -> shops -> ask 3 shops -> watch answers arrive -> visit plan.

## Before judging
Freeze a release 2 days early; don't redeploy during judging. `TOROB_SIMULATE_SELLERS=1` (default) keeps the demo working
without a human seller; the tracker shows a «simulated» banner (`NEXT_PUBLIC_DEMO_MODE` build arg).
Knobs: `TOROB_INQUIRY_TIMEOUT_S` (default 300), `TOROB_LIVE_SHOPS` (shop ids answered by real people).

## Alternative: two apps
`backend/Dockerfile` + `frontend/Dockerfile` (+ their `liara.json`) still work for a two-app split; set the frontend's
`API_URL` to the backend's public URL.
