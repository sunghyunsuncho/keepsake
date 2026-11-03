from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.api import account, auth, billing, health, sync, uploads
from app.cloud import UserGone
from app.monitoring import init_sentry

init_sentry()


def _operation_id(route: APIRoute) -> str:
    # 생성되는 TS 클라이언트의 함수 이름을 "health_ready"처럼 짧게 유지한다.
    return f"{route.tags[0]}_{route.name}" if route.tags else route.name


app = FastAPI(title="Keepsake API", version="0.1.0", generate_unique_id_function=_operation_id)


@app.exception_handler(UserGone)
def account_unavailable(_request: Request, _exc: UserGone) -> JSONResponse:
    # 인증을 통과한 뒤 잠금을 기다리는 사이 계정이 지워졌다. 인증 실패와 같게 답한다.
    return JSONResponse({"detail": "account unavailable"}, status.HTTP_401_UNAUTHORIZED)


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(account.router)
app.include_router(sync.router)
app.include_router(uploads.router)
app.include_router(billing.router)
