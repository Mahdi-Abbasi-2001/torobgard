# Single-container build for Liara: Next.js (public) + FastAPI (private, 127.0.0.1) in one app.
# Three stages so a code change never redoes the slow catalog build (Liara's builder has a time limit):
#   web: Next standalone server · catalog: SQLite catalog from the dataset (only the ingest code and the dataset as
#   inputs, stdlib only) · final: python runtime + node binary + both.

# Stage: build the SQLite catalog. Inputs are only the dataset and the modules app.ingest.build imports, so this layer
# stays cached across ordinary backend changes.
FROM python:3.12-slim AS catalog
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /build
COPY backend/app/__init__.py backend/app/db.py ./app/
COPY backend/app/services/__init__.py backend/app/services/address.py backend/app/services/geo.py \
     backend/app/services/hours.py backend/app/services/text.py ./app/services/
COPY backend/app/ingest ./app/ingest
COPY backend/dataset/dataset.zip /tmp/dataset.zip
RUN python -c "import zipfile; zipfile.ZipFile('/tmp/dataset.zip').extractall('/tmp/raw')" \
 && mkdir -p /app/catalog \
 && TOROB_DB=/app/catalog/catalog.db python -m app.ingest.build /tmp/raw \
 && rm -rf /tmp/raw /tmp/dataset.zip

# Stage: build the Next standalone server.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG NEXT_PUBLIC_DEMO_MODE=1
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Final stage: python runtime + node binary + catalog + both servers.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
# node needs libstdc++, which python:slim may not ship: copy it from the node image, then fail the build early if node can't start
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /usr/lib/x86_64-linux-gnu/libstdc++.so.6* /usr/lib/x86_64-linux-gnu/
RUN ldconfig && node -v

WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY --from=catalog /app/catalog /app/catalog
COPY backend/app ./app

WORKDIR /app/frontend
COPY --from=web /web/.next/standalone ./
COPY --from=web /web/.next/static ./.next/static
COPY --from=web /web/public ./public

COPY deploy/start.sh /app/start.sh
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    API_URL=http://127.0.0.1:8000 \
    TOROB_DB=/app/catalog/catalog.db TOROB_CATALOG_READONLY=1 TOROB_STATE_DB=/data/state.db
EXPOSE 3000
CMD ["/app/start.sh"]
