.PHONY: up down api migrate migration test lint api-types mobile ios icons

# 인프라 (Postgres, S3 호환 스토리지)
up:
	docker compose up -d --wait postgres s3
	cd backend && uv run python -m scripts.create_bucket

down:
	docker compose down

# 백엔드
api:
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8010

migrate:
	cd backend && uv run alembic upgrade head

# 사용법: make migration m="add moments table"
migration:
	cd backend && uv run alembic revision --autogenerate -m "$(m)"

test:
	cd backend && uv run pytest

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	uvx ruff check scripts && uvx ruff format --check scripts
	cd mobile && npx tsc --noEmit && npx expo lint

# Pydantic 모델 → OpenAPI → 모바일 TS 타입
api-types:
	cd backend && uv run python -m scripts.export_openapi
	cd mobile && npm run api:types

# 모바일. vernissage Metro(8081)와 겹치지 않게 8082를 쓴다.
mobile:
	cd mobile && npx expo start --port 8082

# iOS 시뮬레이터용 개발 빌드 설치 (네이티브 설정·패키지가 바뀌었을 때만)
ios:
	cd mobile && npx expo run:ios --port 8082

# mobile/assets/source/keepsake_icon.png → 앱 아이콘·스플래시·스토어 아이콘
icons:
	uv run --with pillow python -I scripts/generate_icons.py
