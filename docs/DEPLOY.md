# Deploying to Liara

Product name: **ترب‌گرد** · Liara app name: **`torob-gard`** (fallback `torob-gard-sc` if taken).

Two Docker apps: **backend** (FastAPI + SQLite) and **frontend** (Next.js). Verified locally: the production image layout
(read-only catalog + state on a separate disk file, state survives restart), the standalone frontend and the runtime
`/api` proxy (incl. SSE streaming). Not verified locally: the Docker builds themselves (no Docker on the dev machine).

## Facts that shape the setup
- The Liara CLI only offers **Iran-region** plans for new apps. **OpenAI blocks Iranian IPs**, so the deployed chat
  can't use OpenAI directly. Use **BoxAPI** (OpenAI-compatible): set `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL`.
  Until then the deployed chat runs the rule-based fallback (tested; the UI shows the «جستجوی ساده» banner).
- Backend must run **one worker** (live-update bus and simulated sellers are in-process).
- The catalog (~460 MB SQLite+FTS) is **built into the image** from the dataset zip (~30-90 s at build); sessions and
  inquiries are stored in `/data/state.db` on a Liara **disk**, so they survive restarts and redeploys.
- Region/prices (Liara `plan ls`): backend ≥ `medium-g2` (1 GB RAM, 825 000 تومان/month); frontend `small-g2`
  (0.5 GB, 475 000 تومان/month) is enough for the standalone Next server.

## One-time setup
```bash
liara app create --app <BACKEND_APP> --platform docker --plan medium-g2
liara disk create --app <BACKEND_APP> --name state --size 1
liara app create --app <FRONTEND_APP> --platform docker --plan small-g2

# secrets: set them yourself, never commit them
liara env set --app <BACKEND_APP> TOROB_SECRET=<long-random> LLM_BASE_URL=<boxapi-openai-compatible-url> LLM_API_KEY=<key> LLM_MODEL=<model>
liara env set --app <FRONTEND_APP> API_URL=https://<BACKEND_APP>.iran.liara.run
```

## Deploy (repeat for each release)
```bash
cp starcoach-dataset-v16-cap300-csv.zip backend/dataset/dataset.zip   # once; gitignored
cd backend  && liara deploy --app <BACKEND_APP>  --platform docker --port 8000
cd ../frontend && liara deploy --app <FRONTEND_APP> --platform docker --port 3000
```
`backend/.liaraignore` / `frontend/.liaraignore` keep `.env`, `node_modules` and `.venv` out of the upload.
If a build fails to fetch pip/npm packages from inside Iran, add `--build-location germany`.

## Smoke test
```bash
curl https://<BACKEND_APP>.iran.liara.run/readyz          # {"ok":true,"products":225903,...}
curl https://<BACKEND_APP>.iran.liara.run/api/chat-status # llm_configured true once BoxAPI vars are set
```
Then on a phone: search → shops → ask 3 shops → watch answers arrive → visit plan.

## Before judging
Freeze a release 2 days early; don't redeploy during judging. `TOROB_SIMULATE_SELLERS=1` (default) keeps the demo
working without a human seller; the tracker shows a «simulated» banner (`NEXT_PUBLIC_DEMO_MODE`, build arg).
Env knobs: `TOROB_INQUIRY_TIMEOUT_S` (default 300), `TOROB_LIVE_SHOPS` (shop ids answered by real people).
