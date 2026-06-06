#!/usr/bin/env bash
# ============================================================
# SMEflow — Full DB Reset + Migration Squash
# Run from: api/
# Usage:    bash scripts/reset_db.sh
# ============================================================
set -euo pipefail

echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  SMEflow DB Reset + Migration Squash                │"
echo "└─────────────────────────────────────────────────────┘"
echo ""

# ── Step 1: Tear down Docker volumes ──────────────────────
echo "▶ Stopping containers and removing volumes..."
docker compose down -v
echo "  ✓ Done"

# ── Step 2: Bring up infrastructure only ──────────────────
echo ""
echo "▶ Starting db, redis, rabbitmq..."
docker compose up -d db redis rabbitmq

echo "  Waiting for Postgres to be ready..."
until docker compose exec db pg_isready -U smeflow -d smeflow > /dev/null 2>&1; do
  sleep 1
  printf "."
done
echo ""
echo "  ✓ Postgres is ready"

# ── Step 3: Activate venv ─────────────────────────────────
echo ""
echo "▶ Activating virtual environment..."
if [ ! -d ".venv" ]; then
  echo "  No .venv found — creating with uv..."
  uv venv
  uv pip install -e ".[dev]"
fi
source .venv/bin/activate

# ── Step 4: Generate squashed migration ───────────────────
echo ""
echo "▶ Generating fresh initial migration from current models..."
alembic revision --autogenerate -m "initial_schema"

# Rename the generated file to 0001_initial_schema.py
GENERATED=$(ls migrations/versions/*.py | grep -v "__init__" | head -1)
RENAMED="migrations/versions/0001_initial_schema.py"
if [ "$GENERATED" != "$RENAMED" ]; then
  mv "$GENERATED" "$RENAMED"
  # Update the revision filename reference inside the file
  echo "  Renamed: $(basename $GENERATED) → 0001_initial_schema.py"
fi

echo "  ✓ Migration generated"

# ── Step 5: Apply migration ───────────────────────────────
echo ""
echo "▶ Applying migration..."
alembic upgrade head
echo "  ✓ Migration applied"

echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  ✅ DB reset complete. Review the generated file:   │"
echo "│     migrations/versions/0001_initial_schema.py      │"
echo "│                                                     │"
echo "│  NOTE: autogenerate won't capture raw SQL           │"
echo "│  (triggers, custom functions). Check model files.   │"
echo "└─────────────────────────────────────────────────────┘"
echo ""
