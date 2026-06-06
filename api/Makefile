.PHONY: help install dev up down logs shell db-shell migrate migrate-auto schema-check test lint typecheck format clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Setup ──────────────────────────────────────────────
install: ## Install dependencies with uv
	pip install uv
	uv sync --extra dev
	uv run pre-commit install

# ── Docker ──────────────────────────────────────────────
up: ## Start all services
	docker compose up -d --build
	@echo "API:       http://localhost:8000/api/docs"
	@echo "RabbitMQ:  http://localhost:15672 (guest/guest)"
	@echo "Flower:    http://localhost:5555"

down: ## Stop all services
	docker compose down

logs: ## Tail all logs
	docker compose logs -f

logs-api: ## Tail API logs only
	docker compose logs -f api

shell: ## Open shell in API container
	docker compose exec api bash

db-shell: ## Open psql in DB container
	docker compose exec db psql -U smeflow -d smeflow

redis-cli: ## Open redis-cli
	docker compose exec redis redis-cli

# ── Database ────────────────────────────────────────────
migrate: ## Run Alembic migrations
	uv run python -m alembic upgrade head

migrate-down: ## Rollback last migration
	uv run python -m alembic downgrade -1

migrate-auto: ## Autogenerate migration (usage: make migrate-auto MSG="add_users_table")
	uv run python -m alembic revision --autogenerate -m "$(MSG)"

migrate-history: ## Show migration history
	uv run python -m alembic history --verbose

schema-check: ## Verify DB is migrated and required runtime tables exist
	uv run python -m scripts.check_schema

# ── Development ─────────────────────────────────────────
dev: ## Run API in dev mode (local, no Docker)
	uv run uvicorn apps.api.main:app --host 0.0.0.0 --port 8000 --reload

worker: ## Run Celery worker locally
	uv run celery -A apps.api.workers.celery_app worker -Q default,payments,invoicing,credit -c 2 --loglevel=info

beat: ## Run Celery beat locally
	uv run celery -A apps.api.workers.celery_app beat --scheduler redbeat.RedBeatScheduler --loglevel=info

# ── Testing ─────────────────────────────────────────────
test: ## Run all tests
	uv run pytest

test-unit: ## Run unit tests only
	uv run pytest apps/api/tests/unit -q

test-integration: ## Run integration tests only
	uv run pytest apps/api/tests/integration -q

test-cov: ## Run tests with HTML coverage report
	uv run pytest apps/api/tests/unit apps/api/tests/integration --cov=apps/api --cov-report=term-missing --cov-fail-under=80 --cov-report=html
	@echo "Coverage report: htmlcov/index.html"

test-load: ## Run Locust load test (requires running API)
	uv run locust -f apps/api/tests/load/locustfile.py --host=http://localhost:8000

# ── Code Quality ────────────────────────────────────────
lint: ## Run ruff linter
	uv run ruff check apps/ libs/

lint-fix: ## Run ruff linter with auto-fix
	uv run ruff check --fix apps/ libs/

typecheck: ## Run mypy type checker
	uv run mypy apps/api --ignore-missing-imports

security: ## Run bandit security scan
	uv run bandit -r apps/api -ll --exclude apps/api/tests

format: ## Format code with ruff
	uv run ruff format apps/ libs/

check: lint typecheck security ## Run all checks

# ── Utilities ───────────────────────────────────────────
clean: ## Remove cache files
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .mypy_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name htmlcov -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete

generate-secret: ## Generate a secure SECRET_KEY
	python -c "import secrets; print(secrets.token_hex(32))"

openapi-export: ## Export OpenAPI spec to JSON and YAML files
	curl -s -o openapi/v1.raw.json http://localhost:8000/api/openapi.json
	./.venv/bin/python -c "import json, yaml, pathlib; raw=pathlib.Path('openapi/v1.raw.json'); data=json.loads(raw.read_text()); pathlib.Path('openapi/v1.json').write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n'); pathlib.Path('openapi/v1.yaml').write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding='utf-8'); raw.unlink()"
	@echo "Saved to openapi/v1.json and openapi/v1.yaml"
