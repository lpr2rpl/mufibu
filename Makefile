PYTHON ?= python3
NPM ?= npm

.PHONY: ascii-check backend-syntax backend-test frontend-test frontend-build db-smoke rls-test auth-flow-test ci

ascii-check:
	./scripts/ascii_check.sh

backend-syntax:
	$(PYTHON) -c "import pathlib; [compile(p.read_text(), str(p), 'exec') for p in pathlib.Path('backend/app').rglob('*.py')]"

backend-test:
	PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=backend $(PYTHON) -m unittest discover -s backend/tests -p 'test_*.py'

frontend-test:
	cd frontend && CI=true $(NPM) run test:ci

frontend-build:
	cd frontend && $(NPM) run build:ci

db-smoke:
	./scripts/db_bootstrap_smoke.sh

rls-test:
	./scripts/rls_integration_test.sh

auth-flow-test:
	./scripts/auth_flow_test.sh

ci: ascii-check backend-syntax backend-test frontend-test frontend-build
