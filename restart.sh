#!/bin/bash
# ./restart.sh         -- API 서버 재시작 (.env 변경 반영. 코드 변경은 hot reload로 자동 반영)
# ./restart.sh --all   -- 컨테이너까지 재시작

set -euo pipefail

BOLD="\033[1m"
YELLOW="\033[33m"
RESET="\033[0m"

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE=(docker compose --env-file "$ROOT/compose.dev.env" -f "$ROOT/docker-compose.yml")

echo -e "${BOLD}Keepsake 재시작${RESET}"

"$ROOT/stop.sh" --api

if [ "${1:-}" = "--all" ] || [ "${1:-}" = "-a" ]; then
  echo -e "${YELLOW}컨테이너 재시작 포함${RESET}"
  "${COMPOSE[@]}" restart
fi

"$ROOT/start.sh"
