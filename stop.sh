#!/bin/bash
# ./stop.sh           -- API 서버 + 컨테이너 중지 (데이터 보존)
# ./stop.sh --api     -- API 서버만 중지
# ./stop.sh --clean   -- API 서버 중지 + 컨테이너·네트워크 제거 (볼륨 보존)
# ./stop.sh --reset   -- API 서버 중지 + 컨테이너·볼륨(DB, S3 사진) 전체 삭제

set -euo pipefail

BOLD="\033[1m"
RED="\033[31m"
GREEN="\033[32m"
RESET="\033[0m"

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=compose.dev.env
source "$ROOT/compose.dev.env"
COMPOSE=(docker compose --env-file "$ROOT/compose.dev.env" -f "$ROOT/docker-compose.yml")
API_PID="$ROOT/logs/api.pid"

stop_api() {
  if [ -f "$API_PID" ]; then
    pid=$(cat "$API_PID")
    # 오래된 PID 파일의 번호가 다른 프로세스에 재사용됐을 수 있다. uvicorn일 때만 종료한다.
    if kill -0 "$pid" 2>/dev/null && ps -o command= -p "$pid" | grep -q '[u]vicorn'; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$API_PID"
  fi
  # uv → uvicorn reloader → worker 중 남은 프로세스가 포트를 잡고 있으면 정리한다 (uvicorn만).
  for _ in $(seq 1 10); do
    PIDS=$(lsof -nP -t -iTCP:"$API_PORT" -sTCP:LISTEN 2>/dev/null || true)
    [ -z "$PIDS" ] && break
    for pid in $PIDS; do
      ps -o command= -p "$pid" | grep -q uvicorn && kill "$pid" 2>/dev/null || true
    done
    sleep 0.3
  done
  echo -e "${GREEN}API 서버 중지${RESET}"
}

case "${1:-}" in
  --api)
    stop_api
    ;;
  --clean)
    echo -e "${BOLD}컨테이너 및 네트워크 제거 (볼륨 보존)${RESET}"
    stop_api
    "${COMPOSE[@]}" down
    echo -e "${GREEN}완료${RESET}"
    ;;
  --reset)
    echo -e "${RED}${BOLD}경고: DB와 S3(Cloud 사진)를 포함한 모든 볼륨이 삭제됩니다.${RESET}"
    read -r -p "계속하시겠습니까? (yes 입력): " confirm
    if [ "$confirm" = "yes" ]; then
      stop_api
      "${COMPOSE[@]}" down -v
      echo -e "${GREEN}초기화 완료. 다시 시작: ./start.sh${RESET}"
    else
      echo "취소됨"
    fi
    ;;
  *)
    echo -e "${BOLD}서비스 중지 (데이터 보존)${RESET}"
    stop_api
    "${COMPOSE[@]}" stop
    echo -e "${GREEN}중지 완료. 재시작: ./start.sh${RESET}"
    ;;
esac
