# 모든 모델을 여기서 import 해야 Alembic autogenerate가 테이블을 인식한다.
from app.db import Base
from app.models.cloud import (
    AuthIdentity,
    BillingEvent,
    CloudObject,
    Device,
    DeviceLink,
    Entitlement,
    Moment,
    SyncRecord,
    Usage,
    User,
)

__all__ = [
    "Base",
    "AuthIdentity",
    "BillingEvent",
    "CloudObject",
    "Device",
    "DeviceLink",
    "Entitlement",
    "Moment",
    "SyncRecord",
    "Usage",
    "User",
]
