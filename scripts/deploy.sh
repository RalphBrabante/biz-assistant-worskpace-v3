#!/usr/bin/env bash
# Usage:
#   bash scripts/deploy.sh staging             # Deploy staging from main
#   bash scripts/deploy.sh staging develop      # Deploy staging from develop branch
#   bash scripts/deploy.sh production           # Deploy production from main
set -euo pipefail

ENVIRONMENT="${1:-}"
BRANCH="${2:-main}"

case "$ENVIRONMENT" in
  staging)
    COMPOSE_FILE="docker-compose.staging.yml"
    ENV_FILE=".env.staging"
    ;;
  production)
    COMPOSE_FILE="docker-compose.prod.yml"
    ENV_FILE=".env.production"
    ;;
  *)
    echo "Usage: $0 <staging|production> [branch]"
    echo ""
    echo "  $0 staging              Deploy staging from main"
    echo "  $0 staging develop      Deploy staging from develop branch"
    echo "  $0 production           Deploy production from main"
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found."
  echo "Create it from the example:"
  echo "  cp ${ENV_FILE}.example $ENV_FILE"
  echo "  nano $ENV_FILE"
  exit 1
fi

COMPOSE="docker compose -p $ENVIRONMENT -f $COMPOSE_FILE --env-file $ENV_FILE"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "  Deploying: $ENVIRONMENT  |  Branch: $BRANCH"
echo "╚══════════════════════════════════════════════╝"
echo ""

echo "==> Pulling latest code (branch: $BRANCH)..."
git fetch --all --prune
git checkout "$BRANCH"
git pull origin "$BRANCH"
git submodule update --init --recursive

echo ""
echo "==> Building Angular client..."
$COMPOSE --profile build run --rm biz-assitant-client-build

echo ""
echo "==> Starting services..."
$COMPOSE up -d --build --remove-orphans

echo ""
echo "==> [$ENVIRONMENT] Deployment complete!"
echo ""
$COMPOSE ps
echo ""
echo "Useful commands:"
echo "  Logs:    docker compose -p $ENVIRONMENT -f $COMPOSE_FILE --env-file $ENV_FILE logs -f"
echo "  Shell:   docker compose -p $ENVIRONMENT -f $COMPOSE_FILE --env-file $ENV_FILE exec biz-assitant-api sh"
echo "  Restart: docker compose -p $ENVIRONMENT -f $COMPOSE_FILE --env-file $ENV_FILE restart biz-assitant-api"
