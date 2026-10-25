# Aistrix API. Works on any container host (Fly, Render, Railway, Cloud Run,
# ECS…). Settings come from the host's environment, never from a baked-in .env
# (see .dockerignore and docs/launch-checklist.md).
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000 \
    WEB_CONCURRENCY=2 \
    TELEMETRY_OUTBOX_PATH=/data/telemetry-outbox.sqlite3

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY main.py telemetry.py tool_contracts.py flow_plan.py spend_guard.py outbound.py ./

# Runs as a non-root user. /data holds the run-telemetry outbox: mount a
# persistent volume there so run outcomes survive a restart.
RUN useradd --create-home --uid 10001 aistrix && mkdir -p /data && chown aistrix /data
USER aistrix
VOLUME ["/data"]

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/health/ready', timeout=4)"

# --proxy-headers: the host's load balancer terminates HTTPS. Set
# TRUST_PROXY_HEADERS=1 too, so rate limits see visitors' real addresses.
# Each worker runs the scheduler and recovery loops; their work is claimed in
# the database, so several workers (or servers) never do it twice.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers ${WEB_CONCURRENCY} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 30"]
