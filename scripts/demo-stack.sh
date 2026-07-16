#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${DEMO_ENV_FILE:-"$ROOT_DIR/.env.demo"}
PROJECT_NAME=${DEMO_COMPOSE_PROJECT:-fulltext-rss-reader-demo}
COMPOSE_FILE="$ROOT_DIR/docker-compose.demo.yml"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing demo environment file: $ENV_FILE" >&2
  echo "Copy .env.demo.example to .env.demo and replace all placeholder secrets." >&2
  exit 2
fi

compose() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    --file "$COMPOSE_FILE" \
    "$@"
}

case "${1:-up}" in
  up)
    compose up --detach --build --wait web-demo
    ;;
  reseed)
    compose run --rm seed-demo
    compose restart web-demo
    ;;
  reset)
    compose down --volumes --remove-orphans
    compose up --detach --build --wait web-demo
    ;;
  down)
    compose down --remove-orphans
    ;;
  destroy)
    compose down --volumes --remove-orphans
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs --follow --tail=200 web-demo
    ;;
  *)
    echo "Usage: $0 {up|reseed|reset|down|destroy|status|logs}" >&2
    exit 2
    ;;
esac
