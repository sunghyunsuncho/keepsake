from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # 계정 삭제 요청 시각. R2 삭제가 실패하면 정리 작업이 이 표시를 보고 다시 지운다.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 동기화 변경 번호. push 때 사용자 행을 잠그고 올려서, pull 커서가 기기 시계와 무관해진다.
    sync_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    # 클라우드 데이터를 지울 때마다(유예 만료) 올린다. 값이 바뀌면 기기는 계정 공간을 비운다.
    # 그대로 두면 재구독해도 기기는 이미 올렸다고 여긴다.
    data_generation: Mapped[int] = mapped_column(Integer, default=0)


class AuthIdentity(Base):
    __tablename__ = "auth_identities"
    __table_args__ = (UniqueConstraint("provider", "subject", name="uq_identity_provider_subject"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    subject: Mapped[str] = mapped_column(String(255))


class Entitlement(Base):
    """구독 상태. 앱이 보낸 값이 아니라 RevenueCat webhook·REST 조회 결과로만 바뀐다."""

    __tablename__ = "entitlements"
    # 주기 작업이 grace 구독과, 만료 시각이 지난 active 구독을 찾는다.
    __table_args__ = (Index("ix_entitlements_status_expires", "status", "expires_at"),)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    plan: Mapped[str] = mapped_column(String(32), default="cloud")
    # none: 구독한 적 없음 / active / grace: 만료 후 30일 읽기 전용 / expired: 클라우드 삭제됨
    status: Mapped[str] = mapped_column(String(16), default="none")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    grace_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 유예 중 보낸 마지막 알림 단계 ('expired' | 'd7' | 'd1'). 재구독하면 비운다.
    notified_stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 마지막 유예 알림을 보낸 시각. 삭제 직전 경고를 받고 내려받을 시간을 보장한다.
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 마지막으로 반영한 webhook 이벤트 시각. 늦게 도착한 옛 이벤트가 최신 상태를 덮지 않게 한다.
    event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="revenuecat")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Moment(Base):
    __tablename__ = "moments"
    # pull: WHERE user_id = ? AND seq > ? ORDER BY seq
    __table_args__ = (Index("ix_moments_user_seq", "user_id", "seq"),)
    # id는 기기가 만든 UUID다. 한 기기에서 계정을 바꿔 로그인하면 같은 id를 다른 계정도 올리므로
    # 사용자별로 구분한다.
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # 기기 스키마의 열(메모, 장소 등)을 JSON으로 보관한다. 서버 규칙은 id·시각만 본다.
    data: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seq: Mapped[int] = mapped_column(BigInteger)


class SyncRecord(Base):
    """moments 외의 동기화 테이블(review_sessions, albums, album_moments)."""

    __tablename__ = "sync_records"
    __table_args__ = (Index("ix_sync_records_user_seq", "user_id", "seq"),)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(32), primary_key=True)
    # album_moments처럼 복합 키인 행은 기기가 "album_id:moment_id"로 보낸다.
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    data: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seq: Mapped[int] = mapped_column(BigInteger)


class DeviceLink(Base):
    """기록과 그 기기 사진첩 사진의 연결. 재설치한 같은 기기에서 원본을 다시 찾을 때만 쓴다.

    사진 id는 기기마다 다르므로 계정·기기별로 두고, 다른 기기에는 내려주지 않는다.
    """

    __tablename__ = "device_links"
    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "moment_id"], ["moments.user_id", "moments.id"], ondelete="CASCADE"
        ),
        # 기록을 지울 때 cascade가 기기와 상관없이 찾는다.
        Index("ix_device_links_user_moment", "user_id", "moment_id"),
    )
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    # 앱이 기기 고유값과 user_id를 해시해서 만든다. 계정이 다르면 같은 기기여도 값이 다르다.
    device_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    moment_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(255))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class CloudObject(Base):
    __tablename__ = "cloud_objects"
    __table_args__ = (
        UniqueConstraint("user_id", "moment_id", "variant", name="uq_cloud_object_variant"),
        ForeignKeyConstraint(
            ["user_id", "moment_id"], ["moments.user_id", "moments.id"], ondelete="CASCADE"
        ),
        # 정리 작업이 deleting·pending만 찾는다 (대부분은 stored).
        Index("ix_cloud_objects_status", "status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    # 사용자별 조회는 uq_cloud_object_variant(user_id, ...)가 맡는다.
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    moment_id: Mapped[str] = mapped_column(String(36))
    variant: Mapped[str] = mapped_column(String(16))
    r2_key: Mapped[str] = mapped_column(String(1024), unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    md5: Mapped[str] = mapped_column(String(32))
    content_type: Mapped[str] = mapped_column(String(128))
    # pending: presigned URL 발급 / stored: 크기 검증 완료 / deleting: 기록 삭제로 R2에서 지울 예정
    status: Mapped[str] = mapped_column(String(16), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Usage(Base):
    __tablename__ = "usage"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    bytes_total: Mapped[int] = mapped_column(BigInteger, default=0)
    object_count: Mapped[int] = mapped_column(Integer, default=0)


class Device(Base):
    """유예 알림을 보낼 Expo 푸시 토큰."""

    __tablename__ = "devices"
    token: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(16))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class BillingEvent(Base):
    __tablename__ = "billing_events"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    raw_payload: Mapped[str] = mapped_column(Text)
    # 보관 기간이 지난 행을 주기 작업이 지운다.
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StorageCleanup(Base):
    """나중에 지울 R2 객체(키 또는 prefix). 대체·실패한 업로드, 지운 기록, 유예 만료, 계정 삭제."""

    __tablename__ = "storage_cleanups"
    prefix: Mapped[str] = mapped_column(String(1024), primary_key=True)
    not_before: Mapped[datetime] = mapped_column(DateTime(timezone=True))
