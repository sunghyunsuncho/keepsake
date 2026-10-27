from fastapi import FastAPI
from fastapi.routing import APIRoute

from app.api import health


def _operation_id(route: APIRoute) -> str:
    # 생성되는 TS 클라이언트의 함수 이름을 "health_ready"처럼 짧게 유지한다.
    return f"{route.tags[0]}_{route.name}" if route.tags else route.name


app = FastAPI(title="Keepsake API", version="0.1.0", generate_unique_id_function=_operation_id)

app.include_router(health.router)
