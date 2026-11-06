#!/bin/bash
# 실기기 테스트용으로 로컬 주소를 이 맥의 LAN IP로 바꾼다.
#   mobile/.env   EXPO_PUBLIC_API_URL  → http://<IP>:API_PORT
#   backend/.env  R2_ENDPOINT_URL      → http://<IP>:S3_PORT  (presigned 사진 URL을 휴대폰이 열 수 있게)
#
# ./set-ip.sh           -- LAN IP로 변경 (Wi-Fi가 바뀌면 다시 실행)
# ./set-ip.sh --local   -- localhost로 되돌림 (iOS 시뮬레이터)
#
# 바꾼 뒤 API 서버가 실행 중이면 재시작한다. Expo 개발 서버는 직접 재시작해야 한다.

set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=compose.dev.env
source "$ROOT/compose.dev.env"
MOBILE_ENV="$ROOT/mobile/.env"
BACKEND_ENV="$ROOT/backend/.env"

for f in "$MOBILE_ENV" "$BACKEND_ENV"; do
  if [ ! -f "$f" ]; then
    echo -e "${RED}오류: ${f#"$ROOT"/} 가 없습니다. .env.example을 복사해 만드세요.${RESET}"
    exit 1
  fi
done

if [ "${1:-}" = "--local" ]; then
  HOST="localhost"
else
  # IP 감지 (en0 → en1 순으로 시도)
  HOST=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
  if [ -z "$HOST" ]; then
    echo -e "${RED}오류: 로컬 IP를 감지할 수 없습니다. Wi-Fi 또는 네트워크 연결을 확인하세요.${RESET}"
    exit 1
  fi
fi

# KEY=값 라인을 바꾸고, 없으면 끝에 추가한다. 바뀌었으면 1을 출력한다.
set_env() {
  python3 - "$1" "$2" "$3" <<'PYEOF'
import re, sys

path, key, value = sys.argv[1:]
with open(path) as f:
    original = f.read()

line = f"{key}={value}"
pattern = rf"^{re.escape(key)}=.*$"
if re.search(pattern, original, re.MULTILINE):
    content = re.sub(pattern, line, original, count=1, flags=re.MULTILINE)
else:
    content = original.rstrip("\n") + f"\n{line}\n"

if content != original:
    with open(path, "w") as f:
        f.write(content)
    print(1)
PYEOF
}

API_URL="http://${HOST}:${API_PORT}"
S3_URL="http://${HOST}:${S3_PORT}"
MOBILE_CHANGED=$(set_env "$MOBILE_ENV" EXPO_PUBLIC_API_URL "$API_URL")
BACKEND_CHANGED=$(set_env "$BACKEND_ENV" R2_ENDPOINT_URL "$S3_URL")

echo -e "${BOLD}완료${RESET}"
echo -e "  mobile/.env   ${GREEN}EXPO_PUBLIC_API_URL=${API_URL}${RESET}"
echo -e "  backend/.env  ${GREEN}R2_ENDPOINT_URL=${S3_URL}${RESET}"

if [ -z "$MOBILE_CHANGED" ] && [ -z "$BACKEND_CHANGED" ]; then
  echo "이미 최신입니다."
  exit 0
fi

if [ -n "$BACKEND_CHANGED" ] && [ -f "$ROOT/logs/api.pid" ] && kill -0 "$(cat "$ROOT/logs/api.pid")" 2>/dev/null; then
  echo ""
  "$ROOT/restart.sh"
fi

if [ -n "$MOBILE_CHANGED" ]; then
  echo -e "${YELLOW}Expo 개발 서버가 떠 있으면 재시작하세요 (make mobile). EXPO_PUBLIC_ 값은 시작할 때 읽습니다.${RESET}"
fi
