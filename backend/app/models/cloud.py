from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
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
    # 요금제 (app/plans.py). 구독한 스토어 상품으로 정한다.
    plan: Mapped[str] = mapped_column(String(32), default="cloud_10gb")
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
    # 관리자가 정한 이용 상태. RevenueCat이 바꾸는 status와 따로 둔다 (cloud.subscription_status).
    # cloud: 결제 없이 구독 회원 / None: 결제 상태를 따른다
    access_override: Mapped[str | None] = mapped_column(String(16), nullable=True)
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


class SharedAlbum(Base):
    """여러 계정이 함께 쓰는 안전 앨범 (가족·친구·파트너). 서버가 기준이라 sync_records에 없다.

    파일은 올린 사람의 Cloud 파일(cloud_objects) 그대로 두고 복사·이동하지 않는다. 용량만 나눠 센다:
    앨범이 쓰는 파일은 올린 사람의 개인 사용량이 아니라 앨범 사용량이고, 앨범 용량은 구성원이 각자
    자기 안전 보관 용량에서 떼어 준 할당의 합이다. 앨범 수는 소유자의 요금제에 묶인다
    (app/plans.py).
    """

    __tablename__ = "shared_albums"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str] = mapped_column(String(80))
    # 'family' | 'friends' | 'partner' | 'other'. 목록의 아이콘과 문구만 바꾼다.
    relation: Mapped[str] = mapped_column(String(16), default="other")
    # 구성원이 담은 사진을 올릴 화질. 'original' | 'display' (안전 앨범과 같다)
    photo_quality: Mapped[str] = mapped_column(String(16), default="original")
    # 표지. 'latest'(가장 최근 사진) | 'photo'(고른 항목) | 'design'(이모지). 안전 앨범과 같다.
    cover_mode: Mapped[str] = mapped_column(String(16), default="latest", server_default="latest")
    # 고른 항목. 그 항목이 빠지면 가장 최근 사진으로 보여 준다 (항목이 지워져도 남으므로 FK를
    # 두지 않는다).
    cover_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    cover_emoji: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    # 항목 번호. 앨범 행을 잠그고 올려서 목록 커서가 추가 순서를 따른다.
    item_seq: Mapped[int] = mapped_column(BigInteger, default=0)
    # 이 앨범을 자기 요금제의 공유 앨범 수로 세는 사람 (관리자 중 한 명).
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 추가 구매한 용량. 결제는 아직 없다 (docs/PRICING.md).
    extra_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    # 앨범이 쓰는 파일 크기의 합 (항목 bytes의 합). 바뀔 때마다 그 차이만 더한다 (app/shared.py
    # recount).
    bytes_total: Mapped[int] = mapped_column(BigInteger, default=0)
    # 사진이 있는데 앨범 용량이 0이 된 시각 (나눠 준 구성원이 모두 나갔거나 구독이 끝났다).
    # 용량을 바꾸는 일이 생길 때 고친다 (app/shared.py refresh_funding). 주기 작업은 이 값이
    # 있는 앨범만 본다.
    unfunded_since: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    # 구성원에게 정리 기한을 알린 시각. 기한은 이때부터 센다 (알림 없이 지우지 않는다).
    unfunded_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SharedAlbumMember(Base):
    __tablename__ = "shared_album_members"
    album_id: Mapped[str] = mapped_column(
        ForeignKey("shared_albums.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    # admin: 앨범·구성원·모든 사진 관리 / member: 사진을 담고, 자신이 담은 사진만 지운다
    role: Mapped[str] = mapped_column(String(16), default="member")
    # 이 앨범에서 보일 이름 ("엄마", "지민"). 계정 이메일은 다른 구성원에게 보여주지 않는다.
    display_name: Mapped[str] = mapped_column(String(40))
    # 내 안전 보관 용량에서 이 앨범에 떼어 준 용량. 쓰지 않아도 내 남은 용량에서 빠진다.
    # 구독이 끝나면(유예가 지나면) 앨범 용량에 세지 않는다.
    allocated_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SharedAlbumInvite(Base):
    """초대 코드. 앨범마다 하나만 살아 있고, 기한 안에는 여러 사람이 같은 코드로 참여한다."""

    __tablename__ = "shared_album_invites"
    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    album_id: Mapped[str] = mapped_column(
        ForeignKey("shared_albums.id", ondelete="CASCADE"), unique=True
    )
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SharedAlbumItem(Base):
    """공유 앨범에 담은 사진 한 장. 올린 사람의 기록과 그 Cloud 파일을 가리킨다.

    담을 때 촬영 정보를 옮겨 둔다. 올린 사람이 자기 기록을 지우거나 앨범을 나가도(사진을 남기기로
    했으면) 앨범에 남고, 그 파일은 앨범이 쓰는 동안 지우지 않는다.
    """

    __tablename__ = "shared_album_items"
    __table_args__ = (
        UniqueConstraint("album_id", "author_id", "moment_id", name="uq_shared_item_moment"),
        Index("ix_shared_items_album_seq", "album_id", "seq"),
        # 올린 사람의 기기가 자기가 담은 항목을 찾는다 (올릴 파일).
        Index("ix_shared_items_author", "author_id", "moment_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    album_id: Mapped[str] = mapped_column(ForeignKey("shared_albums.id", ondelete="CASCADE"))
    # 나간 구성원·지운 계정의 사진도 남을 수 있어 FK를 두지 않는다.
    author_id: Mapped[str] = mapped_column(String(36))
    # 올린 사람의 기록 id (그 사람의 기기가 원본을 찾아 올릴 때 쓴다)
    moment_id: Mapped[str] = mapped_column(String(36))
    seq: Mapped[int] = mapped_column(BigInteger)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # 이 사진만 따로 고른 화질 ('original' | 'display'). None이면 앨범 화질을 따른다.
    # 파일은 사진마다 하나라 구성원 모두 같은 파일을 보고, 앨범 사용량도 사진마다 남기는 파일로
    # 센다 (app/shared.py item_quality).
    photo_quality: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # 담은 사람이 구성원에게 보여 줄 글. 개인 메모와 따로 둔다 (메모는 구성원에게 보내지 않는다).
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 담을 때의 촬영 정보. 메모와 장소는 개인 기록이라 옮기지 않는다.
    media_type: Mapped[str] = mapped_column(String(8), default="photo")
    duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    taken_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    taken_tz_offset: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 공유 앨범에서 효율 보관 JPEG를 내려받을 때도 EXIF GPS를 되살리기 위한 좌표.
    # 장소 이름·메모는 개인 기록이라 계속 공유하지 않는다.
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 이 항목이 앨범 화질로 쓰는 파일 크기 (저장된 것만). 앨범 bytes_total의 한 몫이다.
    bytes: Mapped[int] = mapped_column(BigInteger, default=0)


class SharedItemComment(Base):
    """공유 앨범 사진에 구성원이 남긴 댓글. 그 사진을 볼 수 있는 구성원끼리만 보인다.

    사진이 빠지거나 앨범이 지워지면 함께 지운다. 앨범을 나가도 남기지만(이름은 '나간 구성원'),
    사진까지 빼고 나가거나 내보내지면 그 사람이 이 앨범에 남긴 댓글도 지운다.
    """

    __tablename__ = "shared_item_comments"
    __table_args__ = (Index("ix_shared_item_comments_item", "item_id", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    album_id: Mapped[str] = mapped_column(
        ForeignKey("shared_albums.id", ondelete="CASCADE"), index=True
    )
    item_id: Mapped[str] = mapped_column(ForeignKey("shared_album_items.id", ondelete="CASCADE"))
    # 계정을 지우면 그 사람의 댓글도 지운다. 인덱스가 없으면 계정을 지울 때 댓글 전체를 훑는다.
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserBlock(Base):
    """내가 차단한 사람. 그 사람이 공유 앨범에 담은 사진을 모든 앨범에서 나에게 보여 주지 않는다.

    앨범에서 내보내지는 않으므로 다른 구성원에게는 그대로 보이고, 차단당한 사람은 알 수 없다.
    """

    __tablename__ = "user_blocks"
    blocker_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    blocked_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # 차단할 때 그 사람이 보이던 이름. 앨범을 나간 뒤에도 차단 목록에서 알아보게 한다.
    display_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ContentReport(Base):
    """공유 앨범의 사진이나 구성원 신고. 운영자가 관리자 화면에서 보고 처리한다.

    앨범·항목이 지워져도 기록은 남아야 해서 FK를 두지 않고, 앨범 이름·구성원 이름은 신고할 때의 값을
    옮겨 둔다.
    """

    __tablename__ = "content_reports"
    __table_args__ = (Index("ix_content_reports_status_created", "status", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    reporter_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    album_id: Mapped[str] = mapped_column(String(36))
    album_title: Mapped[str] = mapped_column(String(80))
    reported_user_id: Mapped[str] = mapped_column(String(36))
    reported_name: Mapped[str | None] = mapped_column(String(40), nullable=True)
    # 사진을 신고했을 때만 있다. moment_id는 항목이 빠진 뒤에도 운영자가 파일을 찾게 둔다.
    item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    moment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # 댓글을 신고했을 때만 있다. 댓글이 지워진 뒤에도 운영자가 내용을 보게 신고할 때의 글을
    # 옮겨 둔다.
    comment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    comment_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 'sexual' | 'violence' | 'harassment' | 'spam' | 'other'
    reason: Mapped[str] = mapped_column(String(16))
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # open: 처리 전 / closed: 처리함 (action에 무엇을 했는지)
    status: Mapped[str] = mapped_column(String(16), default="open")
    # 'dismiss' | 'remove_item' | 'remove_comment' | 'remove_member'
    action: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SharedMoment(Base):
    """내 기록 하나를 공유 앨범들이 함께 쓰는 파일 크기 (여러 앨범에 담아도 파일은 한 벌이라 한
    번 센다).

    합이 usage.shared_bytes이고, 개인 사용량은 bytes_total에서 이것을 뺀 값이다.
    행을 잠그고 다시 세서 같은 기록을 두 앨범이 동시에 고쳐도 어긋나지 않는다.
    """

    __tablename__ = "shared_moments"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    moment_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    bytes: Mapped[int] = mapped_column(BigInteger, default=0)


class Usage(Base):
    __tablename__ = "usage"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    bytes_total: Mapped[int] = mapped_column(BigInteger, default=0)
    object_count: Mapped[int] = mapped_column(Integer, default=0)
    # bytes_total 중 공유 앨범이 쓰는 파일 (그 앨범 용량에서 센다). shared_moments의 합이다.
    shared_bytes: Mapped[int] = mapped_column(BigInteger, default=0)


class Device(Base):
    """유예 알림·댓글 알림을 보낼 Expo 푸시 토큰."""

    __tablename__ = "devices"
    token: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(16))
    # 앱 언어 ('ko' | 'en' | 'ja'). 댓글 알림처럼 서버가 만드는 문구를 이 언어로 보낸다.
    language: Mapped[str] = mapped_column(String(8), default="ko", server_default="ko")
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
