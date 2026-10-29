from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.cloud import can_read, can_write
from app.config import get_settings
from app.db import get_db
from app.models.cloud import Entitlement, User

bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: DbSession,
) -> User:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication required")
    settings = get_settings()
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=["HS256"],
            issuer=settings.jwt_issuer,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid access token") from exc
    user = db.get(User, claims.get("sub"))
    if user is None or user.deleted_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "account unavailable")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_write(db: Session, user: User) -> Entitlement:
    entitlement = db.get(Entitlement, user.id)
    if not can_write(entitlement):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "an active Cloud subscription is required")
    assert entitlement is not None
    return entitlement


def require_read(db: Session, user: User) -> Entitlement:
    entitlement = db.get(Entitlement, user.id)
    if not can_read(entitlement):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cloud data is not available")
    assert entitlement is not None
    return entitlement
