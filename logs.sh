#!/bin/bash
# ./logs.sh [서비스]   -- 실시간 로그 (기본: API 서버. alias: a=api, db=postgres, s3)
# ./logs.sh all        -- 컨테이너 전체 로그

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE=(docker compose --env-file "$ROOT/compose.dev.env" -f "$ROOT/docker-compose.yml")
API_LOG="$ROOT/logs/api.log"

case "${1:-api}" in
  a|api|b|backend)
    if [ ! -f "$API_LOG" ]; then
      echo "api.log 없음 — ./start.sh로 API 서버를 먼저 시작하세요."
      exit 1
    fi
    tail -n 100 -f "$API_LOG"
    ;;
  db|pg|postgres) "${COMPOSE[@]}" logs -f --tail=100 postgres ;;
  s3) "${COMPOSE[@]}" logs -f --tail=100 s3 ;;
  all) "${COMPOSE[@]}" logs -f --tail=100 ;;
  *)
    echo "알 수 없는 서비스: $1 (api | db | s3 | all)"
    exit 1
    ;;
esac
