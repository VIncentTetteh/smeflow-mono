FROM python:3.12-slim

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install --no-cache-dir uv

# Install Python deps — copy the lockfile too and install --frozen so builds are
# reproducible (pinned to uv.lock) instead of re-resolving version ranges each time.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

# Copy source
COPY apps/ ./apps/
COPY libs/ ./libs/
COPY migrations/ ./migrations/
COPY scripts/ ./scripts/
COPY alembic.ini .

ENV PYTHONPATH=/app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["gunicorn", "apps.api.main:app", \
     "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "4", "--bind", "0.0.0.0:8000", "--timeout", "30", \
     "--access-logfile", "-", "--error-logfile", "-"]
