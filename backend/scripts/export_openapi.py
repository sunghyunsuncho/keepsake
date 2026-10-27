"""FastAPI OpenAPI 스펙을 파일로 내보낸다. 모바일 TS 타입 생성의 입력이 된다.

사용법: uv run python -m scripts.export_openapi
"""

import json
from pathlib import Path

from app.main import app

OUTPUT = Path(__file__).resolve().parents[1] / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n"


def main() -> None:
    OUTPUT.write_text(render())
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
