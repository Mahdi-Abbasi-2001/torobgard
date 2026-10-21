# Backend image: builds the SQLite catalog (+FTS) from the Torob CSV dump at image build time, so a cold start is instant
# and nothing has to be downloaded or ingested at runtime. Runtime state (sessions, inquiries) lives on a Liara disk.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY dataset/dataset.zip /tmp/dataset.zip
RUN python -c "import zipfile; zipfile.ZipFile('/tmp/dataset.zip').extractall('/tmp/raw')" \
 && mkdir -p /app/catalog \
 && TOROB_DB=/app/catalog/catalog.db python -m app.ingest.build /tmp/raw \
 && rm -rf /tmp/raw /tmp/dataset.zip

ENV TOROB_DB=/app/catalog/catalog.db \
    TOROB_CATALOG_READONLY=1 \
    TOROB_STATE_DB=/data/state.db \
    PORT=8000
EXPOSE 8000
# ONE worker on purpose: the live-update bus and simulated sellers are in-process.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
