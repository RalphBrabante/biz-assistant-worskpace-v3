.PHONY: help \
        deploy-staging deploy-production \
        build-staging build-production \
        start-staging start-production \
        stop-staging stop-production \
        logs-staging logs-production \
        status-staging status-production \
        seed-staging seed-production \
        migrate-staging migrate-production \
        shell-staging shell-production

S := docker compose -p staging    -f docker-compose.staging.yml --env-file .env.staging
P := docker compose -p production -f docker-compose.prod.yml     --env-file .env.production

help:
	@echo ""
	@echo "  Biz Assistant — Deployment Commands"
	@echo "  ─────────────────────────────────────────────────────────────"
	@echo "  make deploy-staging      Full deploy to staging (pull + build + up)"
	@echo "  make deploy-production   Full deploy to production (pull + build + up)"
	@echo ""
	@echo "  make build-staging       Rebuild Angular client for staging"
	@echo "  make build-production    Rebuild Angular client for production"
	@echo ""
	@echo "  make start-staging       Start staging containers (no rebuild)"
	@echo "  make start-production    Start production containers (no rebuild)"
	@echo ""
	@echo "  make stop-staging        Stop staging containers"
	@echo "  make stop-production     Stop production containers"
	@echo ""
	@echo "  make logs-staging        Tail all staging logs"
	@echo "  make logs-production     Tail all production logs"
	@echo ""
	@echo "  make status-staging      Show staging container status"
	@echo "  make status-production   Show production container status"
	@echo ""
	@echo "  make seed-staging        Run all DB seeds on staging (first deploy)"
	@echo "  make seed-production     Run all DB seeds on production (first deploy)"
	@echo ""
	@echo "  make migrate-staging     Run pending DB migrations on staging"
	@echo "  make migrate-production  Run pending DB migrations on production"
	@echo ""
	@echo "  make shell-staging       Open shell in staging API container"
	@echo "  make shell-production    Open shell in production API container"
	@echo "  ─────────────────────────────────────────────────────────────"
	@echo ""

# ─── Full deploys ─────────────────────────────────────────────────────────────
deploy-staging:
	@bash scripts/deploy.sh staging

deploy-production:
	@bash scripts/deploy.sh production

# ─── Client builds ────────────────────────────────────────────────────────────
build-staging:
	$(S) --profile build run --rm biz-assitant-client-build

build-production:
	$(P) --profile build run --rm biz-assitant-client-build

# ─── Start / stop ─────────────────────────────────────────────────────────────
start-staging:
	$(S) up -d

start-production:
	$(P) up -d

stop-staging:
	$(S) down

stop-production:
	$(P) down

# ─── Logs ─────────────────────────────────────────────────────────────────────
logs-staging:
	$(S) logs -f

logs-production:
	$(P) logs -f

# ─── Status ───────────────────────────────────────────────────────────────────
status-staging:
	$(S) ps

status-production:
	$(P) ps

# ─── Migrations ───────────────────────────────────────────────────────────────
migrate-staging:
	$(S) exec -T biz-assitant-api npm run db:migrate

migrate-production:
	$(P) exec -T biz-assitant-api npm run db:migrate

# ─── Seeds (first deploy only) ────────────────────────────────────────────────
seed-staging:
	$(S) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260215016000-seed-rbac-and-default-user.js
	$(S) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260216007000-seed-tax-types.js
	$(S) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260216009000-seed-withholding-tax-types.js
	$(S) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260216024000-seed-ralph-superuser.js
	$(S) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260226001000-seed-gimotech-superuser.js

seed-production:
	$(P) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260215016000-seed-rbac-and-default-user.js
	$(P) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260216007000-seed-tax-types.js
	$(P) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260216009000-seed-withholding-tax-types.js
	$(P) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260216024000-seed-ralph-superuser.js
	$(P) exec -T biz-assitant-api npx sequelize-cli db:seed --seed src/seeders/20260226001000-seed-gimotech-superuser.js

# ─── Shell access ─────────────────────────────────────────────────────────────
shell-staging:
	$(S) exec biz-assitant-api sh

shell-production:
	$(P) exec biz-assitant-api sh
