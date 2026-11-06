#!/bin/bash
# ./start.sh   -- 인프라(Postgres, S3) + 마이그레이션 + API 서버(백그라운드, hot reload) 시작
#
# Expo 개발 서버는 대화형이라 따로 띄운다: make mobile

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=compose.dev.env
source "$ROOT/compose.dev.env"
COMPOSE=(docker compose --env-file "$ROOT/compose.dev.env" -f "$ROOT/docker-compose.yml")
LOG_DIR="$ROOT/logs"
API_LOG="$LOG_DIR/api.log"
API_PID="$LOG_DIR/api.pid"

echo -e "${BOLD}Keepsake 시작${RESET}"

"${COMPOSE[@]}" up -d --wait postgres s3

cd "$ROOT/backend"
uv run python -m scripts.create_bucket
uv run alembic upgrade head

mkdir -p "$LOG_DIR"
if [ -f "$API_PID" ] && kill -0 "$(cat "$API_PID")" 2>/dev/null; then
  echo -e "${YELLOW}API 서버가 이미 실행 중입니다 (pid $(cat "$API_PID")). 재시작: ./restart.sh${RESET}"
elif lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo -e "${RED}포트 ${API_PORT}을 다른 프로세스가 쓰고 있습니다:${RESET}"
  lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN
  exit 1
else
  nohup uv run uvicorn app.main:app --reload --host 0.0.0.0 --port "$API_PORT" >>"$API_LOG" 2>&1 &
  echo $! >"$API_PID"

  # 서버가 응답할 때까지 최대 20초 기다린다.
  ready=false
  for _ in $(seq 1 40); do
    if curl -fs "http://localhost:${API_PORT}/docs" >/dev/null 2>&1; then
      ready=true
      break
    fi
    if ! kill -0 "$(cat "$API_PID")" 2>/dev/null; then
      echo -e "${RED}API 서버가 시작하지 못했습니다. 로그:${RESET}"
      tail -n 30 "$API_LOG"
      rm -f "$API_PID"
      exit 1
    fi
    sleep 0.5
  done
  if [ "$ready" != true ]; then
    echo -e "${RED}API 서버가 20초 안에 응답하지 않았습니다. 로그:${RESET}"
    tail -n 30 "$API_LOG"
    # 응답하지 않는 새 프로세스를 남기면 다음 시작이 포트 충돌로 막힌다.
    if kill -0 "$(cat "$API_PID")" 2>/dev/null; then
      kill "$(cat "$API_PID")" 2>/dev/null || true
    fi
    rm -f "$API_PID"
    exit 1
  fi
fi

echo ""
"${COMPOSE[@]}" ps
echo ""

MAC_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "감지 불가")
echo -e "${GREEN}API Docs   →  http://localhost:${API_PORT}/docs${RESET}"
echo -e "${GREEN}S3 콘솔    →  http://localhost:${S3_CONSOLE_PORT}${RESET}"
echo -e "${CYAN}모바일 API →  http://${MAC_IP}:${API_PORT}  (실기기: ./set-ip.sh)${RESET}"
echo -e "${CYAN}API 로그   →  ./logs.sh api   ·   Expo: make mobile (포트 ${METRO_PORT})${RESET}"
