PYTHON ?= python3
NPM ?= npm

.PHONY: backend-test frontend-test frontend-build db-smoke ci

backend-test:
	PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend $(PYTHON) -m unittest discover -s backend/tests -p 'test_*.py'

frontend-test:
	cd frontend && CI=true $(NPM) run test:ci

frontend-build:
	cd frontend && $(NPM) run build:ci

db-smoke:
	./scripts/db_bootstrap_smoke.sh

ci: backend-test frontend-test frontend-build
