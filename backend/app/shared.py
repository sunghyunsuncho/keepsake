"""공유 앨범 규칙 중 다른 API·주기 작업(업로드·동기화·구독 만료·계정 삭제)도 쓰는 것.

docs/PLAN.md §0 '공유 앨범', docs/PRICING.md.

- 파일은 올린 사람의 Cloud 파일(cloud_objects) 하나뿐이다. 복사하거나 옮기지 않고 용량만 나눠
  센다. 앨범 화질에 필요한 파일은 그 앨범의 사용량이고, 올린 사람의 개인 사용량에서는 뺀다.
- 앨범 용량 = 구독 중(유예 포함)인 구성원이 각자 떼어 준 할당의 합 + 추가 용량.
- 내 안전 보관 용량 = 개인 사용량 + 모든 공유 앨범에 떼어 준 할당 ≤ 요금제 용량.
- 소유자는 관리자 중 한 명이고, 공유 앨범 수는 소유자의 요금제에서 센다.

사용량은 저장해 두고 바뀐 만큼만 고친다 (recount). 읽을 때는 저장한 값만 본다:
  shared_album_items.bytes   항목이 앨범 화질로 쓰는 파일 크기
  shared_albums.bytes_total  그 앨범 항목 bytes의 합
  shared_moments.bytes       내 기록 하나를 공유 앨범들이 함께 쓰는 크기 (한 번만 센다)
  usage.shared_bytes         shared_moments의 합. 개인 사용량 = usage.bytes_total − 이것
하루 한 번 jobs.reconcile_shared_usage가 모두 다시 세어 어긋난 값을 바로잡는다.

잠그는 순서: 사용자 행 → 앨범 행(id 순) → shared_moments 행(기록 순) → usage 행. 앨범에서 시작한
요청(관리자가 사진 빼기 등)은 사용자 행을 잠그지 않는다.
"""

import json
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.cloud import can_write
from app.models.cloud import (
    CloudObject,
    Entitlement,
    Moment,
    SharedAlbum,
    SharedAlbumItem,
    SharedAlbumMember,
    SharedMoment,
    Usage,
)
from app.plans import plan_limit


def moment_data(row: Moment) -> dict[str, Any]:
    try:
        data = json.loads(row.data).get("data", {})
    except (TypeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def lock_album_row(db: Session, album_id: str) -> SharedAlbum | None:
    return db.scalar(
        select(SharedAlbum)
        .where(SharedAlbum.id == album_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


# ---------------------------------------------------------------------------
# 앨범에 필요한 파일


# 항목의 화질: 사진마다 고른 화질이 앨범 화질보다 먼저다 (쿼리용).
ITEM_QUALITY = func.coalesce(SharedAlbumItem.photo_quality, SharedAlbum.photo_quality)


def item_quality(item: SharedAlbumItem, album: SharedAlbum) -> str:
    return item.photo_quality or album.photo_quality


def wanted_variants(quality: str, media_type: str, stored: Iterable[str]) -> set[str]:
    """앨범 화질에 맞춰 남길 파일. 개인 안전 앨범 규칙(mobile photos.ts)과 같다.

    효율 보관 앨범의 동영상은 720p(compact)를 두고, compact가 올라가기 전에는 원본을 지우지 않는다.
    """
    # 썸네일은 표시용과 늘 함께 둔다 (목록·표지).
    variants = {"display", "thumb"}
    if quality == "original":
        variants.add("original")
    elif media_type == "video":
        variants.add("compact")
        if "compact" not in set(stored):
            variants.add("original")
    return variants


def _stored_objects(
    db: Session, user_id: str, moment_ids: Iterable[str]
) -> dict[str, dict[str, CloudObject]]:
    """기록마다 저장된 파일."""
    ids = sorted(set(moment_ids))
    result: dict[str, dict[str, CloudObject]] = {}
    if not ids:
        return result
    for obj in db.scalars(
        select(CloudObject).where(
            CloudObject.user_id == user_id,
            CloudObject.moment_id.in_(ids),
            CloudObject.status == "stored",
        )
    ):
        result.setdefault(obj.moment_id, {})[obj.variant] = obj
    return result


def shared_needs(
    db: Session, user_id: str, moment_ids: list[str] | None = None
) -> dict[str, dict[str, set[str]]]:
    """내가 담은 항목마다 앨범이 쓰는 파일: {기록: {앨범: 파일 종류}}.

    나간 앨범에 남겨 둔 사진도 포함한다 (그 앨범이 계속 쓴다).
    """
    query = (
        select(
            SharedAlbumItem.moment_id,
            SharedAlbumItem.album_id,
            SharedAlbumItem.media_type,
            ITEM_QUALITY,
        )
        .join(SharedAlbum, SharedAlbum.id == SharedAlbumItem.album_id)
        .where(SharedAlbumItem.author_id == user_id)
    )
    if moment_ids is not None:
        query = query.where(SharedAlbumItem.moment_id.in_(moment_ids))
    rows = db.execute(query).all()
    stored = _stored_objects(db, user_id, (row[0] for row in rows))
    needs: dict[str, dict[str, set[str]]] = {}
    for moment_id, album_id, media_type, quality in rows:
        have = stored.get(moment_id, {})
        needs.setdefault(moment_id, {})[album_id] = wanted_variants(quality, media_type, have)
    return needs


def albums_using(db: Session, user_id: str, moment_ids: Iterable[str]) -> list[str]:
    ids = sorted(set(moment_ids))
    if not ids:
        return []
    return sorted(
        set(
            db.scalars(
                select(SharedAlbumItem.album_id).where(
                    SharedAlbumItem.author_id == user_id, SharedAlbumItem.moment_id.in_(ids)
                )
            )
        )
    )


# ---------------------------------------------------------------------------
# 저장해 둔 사용량 고치기


def recount(
    db: Session, user_id: str, moment_ids: Iterable[str], albums: Iterable[SharedAlbum]
) -> None:
    """한 사람의 기록 몇 개에 대해 사용량을 다시 센다. albums: 이미 잠근 앨범 (그 앨범의 항목만
    고친다).

    항목을 넣거나 뺐으면 그 앨범만, 파일이 바뀌었으면 그 기록을 담은 모든 앨범을 넘긴다.
    """
    ids = sorted(set(moment_ids))
    if not ids:
        return
    scope = {album.id: album for album in albums}
    db.flush()
    stored = _stored_objects(db, user_id, ids)
    if scope:
        for item in db.scalars(
            select(SharedAlbumItem).where(
                SharedAlbumItem.author_id == user_id,
                SharedAlbumItem.moment_id.in_(ids),
                SharedAlbumItem.album_id.in_(list(scope)),
            )
        ):
            album = scope[item.album_id]
            objects = stored.get(item.moment_id, {})
            size = sum(
                objects[v].size_bytes
                for v in wanted_variants(item_quality(item, album), item.media_type, objects)
                if v in objects
            )
            album.bytes_total += size - item.bytes
            item.bytes = size
    _recount_moments(db, user_id, ids, stored)


def _recount_moments(
    db: Session,
    user_id: str,
    moment_ids: list[str],
    stored: dict[str, dict[str, CloudObject]] | None = None,
) -> None:
    """shared_moments와 usage.shared_bytes를 고친다. 행을 잠근 뒤 다시 세어 동시에 고쳐도 맞는다."""
    db.flush()
    db.execute(
        insert(SharedMoment)
        .values([{"user_id": user_id, "moment_id": m, "bytes": 0} for m in moment_ids])
        .on_conflict_do_nothing()
    )
    rows = {
        row.moment_id: row
        for row in db.scalars(
            select(SharedMoment)
            .where(SharedMoment.user_id == user_id, SharedMoment.moment_id.in_(moment_ids))
            .order_by(SharedMoment.moment_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    if stored is None:
        stored = _stored_objects(db, user_id, moment_ids)
    needs = shared_needs(db, user_id, moment_ids)
    delta = 0
    for moment_id in moment_ids:
        row = rows[moment_id]
        objects = stored.get(moment_id, {})
        variants = set().union(*needs[moment_id].values()) if moment_id in needs else set()
        size = sum(objects[v].size_bytes for v in variants if v in objects)
        delta += size - row.bytes
        if moment_id in needs:
            row.bytes = size
        else:
            db.delete(row)
    if delta:
        db.execute(
            update(Usage)
            .where(Usage.user_id == user_id)
            .values(shared_bytes=Usage.shared_bytes + delta)
            .execution_options(synchronize_session=False)
        )


def objects_changed(db: Session, user_id: str, moment_ids: Iterable[str]) -> None:
    """내 파일이 올라가거나 지워졌다 (사용자 행을 잠근 요청에서 부른다). 그 기록을 담은 앨범을
    고친다."""
    ids = sorted(set(moment_ids))
    albums = [a for a in (lock_album_row(db, i) for i in albums_using(db, user_id, ids)) if a]
    recount(db, user_id, ids, albums)


def recount_album(db: Session, album: SharedAlbum) -> None:
    """앨범 전체를 다시 센다 (화질을 바꿨을 때, 하루 한 번 바로잡을 때)."""
    by_author: dict[str, set[str]] = {}
    for author_id, moment_id in db.execute(
        select(SharedAlbumItem.author_id, SharedAlbumItem.moment_id).where(
            SharedAlbumItem.album_id == album.id
        )
    ).all():
        by_author.setdefault(author_id, set()).add(moment_id)
    for author_id in sorted(by_author):
        recount(db, author_id, by_author[author_id], [album])
    db.flush()
    album.bytes_total = db.scalar(
        select(func.coalesce(func.sum(SharedAlbumItem.bytes), 0)).where(
            SharedAlbumItem.album_id == album.id
        )
    )


def album_usage(album: SharedAlbum) -> int:
    return album.bytes_total


def author_usage(db: Session, album_id: str) -> dict[str, int]:
    """앨범 사용량을 올린 사람별로. 용량이 넘쳤을 때 누구의 사진을 정리할지 고른다."""
    return {
        author_id: int(size)
        for author_id, size in db.execute(
            select(SharedAlbumItem.author_id, func.sum(SharedAlbumItem.bytes))
            .where(SharedAlbumItem.album_id == album_id)
            .group_by(SharedAlbumItem.author_id)
        ).all()
    }


# ---------------------------------------------------------------------------
# 용량


def is_counted(db: Session, user_id: str) -> bool:
    """할당을 앨범 용량에 세는지. 요금제 용량에서 떼어 준 것이라 구독(유예 포함) 중일 때만 센다."""
    return plan_limit(db.get(Entitlement, user_id)) is not None


def capacity(db: Session, album: SharedAlbum, without: str | None = None) -> int:
    """앨범 용량. without: 그 구성원이 빠졌을 때. 구성원은 30명까지라 매번 센다."""
    members = db.execute(
        select(SharedAlbumMember.user_id, SharedAlbumMember.allocated_bytes).where(
            SharedAlbumMember.album_id == album.id
        )
    ).all()
    return album.extra_bytes + sum(
        allocated
        for user_id, allocated in members
        if user_id != without and allocated > 0 and is_counted(db, user_id)
    )


def allocated_total(db: Session, user_id: str) -> int:
    return (
        db.scalar(
            select(func.coalesce(func.sum(SharedAlbumMember.allocated_bytes), 0)).where(
                SharedAlbumMember.user_id == user_id
            )
        )
        or 0
    )


def personal_used(db: Session, user_id: str) -> int:
    row = db.execute(
        select(Usage.bytes_total, Usage.shared_bytes).where(Usage.user_id == user_id)
    ).first()
    return max(row[0] - row[1], 0) if row else 0


def max_bytes(db: Session, user_id: str) -> int:
    limit = plan_limit(db.get(Entitlement, user_id))
    return limit.max_bytes if limit else 0


def personal_free(db: Session, user_id: str) -> int:
    """할당이나 개인 사진에 더 쓸 수 있는 용량. 음수면 넘쳤다."""
    db.flush()
    return max_bytes(db, user_id) - personal_used(db, user_id) - allocated_total(db, user_id)


def owned_count(db: Session, user_id: str) -> int:
    return db.scalar(select(func.count()).where(SharedAlbum.owner_id == user_id)) or 0


def album_limit(db: Session, user_id: str) -> int:
    """소유할 수 있는 공유 앨범 수. 구독하지 않으면 0."""
    limit = plan_limit(db.get(Entitlement, user_id))
    return limit.shared_albums if limit else 0


def can_own_more(db: Session, user_id: str) -> bool:
    return can_write(db.get(Entitlement, user_id)) and owned_count(db, user_id) < album_limit(
        db, user_id
    )


def refresh_funding(db: Session, album: SharedAlbum) -> None:
    """앨범에 사진이 있는데 용량이 0인지 표시한다 (album은 잠근 상태).

    용량을 바꾸는 일(할당·구성원·사진·구독 만료)마다 부른다. 주기 작업은 표시된 앨범만 정리하므로
    모든 앨범의 구성원 구독을 매번 확인하지 않는다. 다시 용량이 생기면 표시와 알림 기록을 지운다.
    """
    db.flush()
    if album.bytes_total <= 0 or capacity(db, album) > 0:
        album.unfunded_since = None
        album.unfunded_notified_at = None
    elif album.unfunded_since is None:
        album.unfunded_since = datetime.now(UTC)


def funding_changed_for_user(db: Session, user_id: str) -> None:
    """이 사람의 할당을 앨범 용량에 세는지가 바뀌었다 (구독 시작·유예 만료). 그 사람의 앨범을
    다시 본다."""
    for album_id in sorted(
        db.scalars(
            select(SharedAlbumMember.album_id).where(
                SharedAlbumMember.user_id == user_id, SharedAlbumMember.allocated_bytes > 0
            )
        )
    ):
        album = lock_album_row(db, album_id)
        if album is not None:
            refresh_funding(db, album)


# ---------------------------------------------------------------------------
# 항목·구성원·소유자


def member_count(db: Session, album_id: str) -> int:
    return db.scalar(select(func.count()).where(SharedAlbumMember.album_id == album_id)) or 0


def items_of_author(db: Session, album_id: str, author_id: str) -> list[str]:
    return list(
        db.scalars(
            select(SharedAlbumItem.id).where(
                SharedAlbumItem.album_id == album_id, SharedAlbumItem.author_id == author_id
            )
        )
    )


def remove_items(db: Session, album: SharedAlbum, item_ids: list[str]) -> None:
    """항목만 지운다 (album은 잠근 상태). 파일은 올린 사람의 기기가 다른 앨범에 필요 없으면 지운다.

    그 파일은 다시 올린 사람의 개인 사용량이 된다.
    """
    if not item_ids:
        return
    items = db.scalars(select(SharedAlbumItem).where(SharedAlbumItem.id.in_(item_ids))).all()
    by_author: dict[str, set[str]] = {}
    for item in items:
        album.bytes_total -= item.bytes
        by_author.setdefault(item.author_id, set()).add(item.moment_id)
    db.execute(delete(SharedAlbumItem).where(SharedAlbumItem.id.in_(item_ids)))
    for author_id in sorted(by_author):
        _recount_moments(db, author_id, sorted(by_author[author_id]))
    album.updated_at = datetime.now(UTC)
    refresh_funding(db, album)


def delete_album(db: Session, album: SharedAlbum) -> None:
    """앨범을 지운다 (album은 잠근 상태). 담았던 파일은 각자의 개인 사용량으로 돌아간다."""
    by_author: dict[str, set[str]] = {}
    for author_id, moment_id in db.execute(
        select(SharedAlbumItem.author_id, SharedAlbumItem.moment_id).where(
            SharedAlbumItem.album_id == album.id
        )
    ).all():
        by_author.setdefault(author_id, set()).add(moment_id)
    db.delete(album)
    db.flush()
    for author_id in sorted(by_author):
        _recount_moments(db, author_id, sorted(by_author[author_id]))


def _members(db: Session, album_id: str) -> list[SharedAlbumMember]:
    return list(
        db.scalars(
            select(SharedAlbumMember)
            .where(SharedAlbumMember.album_id == album_id)
            .order_by(SharedAlbumMember.joined_at, SharedAlbumMember.user_id)
        )
    )


def pick_owner(db: Session, album: SharedAlbum, members: list[SharedAlbumMember]) -> None:
    """소유자를 넘긴다: 공유 앨범을 더 가질 수 있는 관리자 → 구성원 → 가장 먼저 참여한 관리자."""
    admins = [m for m in members if m.role == "admin"]
    for group in (
        [m for m in admins if can_own_more(db, m.user_id)],
        [m for m in members if can_own_more(db, m.user_id)],
        admins,
        members,
    ):
        if group:
            group[0].role = "admin"
            album.owner_id = group[0].user_id
            return
    album.owner_id = None


def remove_member_rows(db: Session, album: SharedAlbum, user_id: str, keep_photos: bool) -> None:
    """구성원을 뺀다. 할당도 함께 빠진다. keep_photos면 그 사람이 담은 사진은 앨범에 남는다.

    관리자가 남지 않으면 가장 먼저 참여한 구성원이 관리자가 되고, 소유자가 나가면 소유자를 넘긴다.
    마지막 구성원이 나가면 앨범을 지운다.
    """
    if not keep_photos:
        remove_items(db, album, items_of_author(db, album.id, user_id))
    member = db.get(SharedAlbumMember, (album.id, user_id))
    if member is not None:
        db.delete(member)
    db.flush()
    remaining = _members(db, album.id)
    if not remaining:
        delete_album(db, album)
        return
    if not any(m.role == "admin" for m in remaining):
        remaining[0].role = "admin"
    if album.owner_id in (user_id, None):
        pick_owner(db, album, remaining)
    album.updated_at = datetime.now(UTC)
    # 나간 사람의 할당이 빠져 용량이 0이 됐을 수 있다.
    refresh_funding(db, album)


def remove_my_items(db: Session, user_id: str, moment_ids: list[str]) -> int:
    """내 기록을 모든 공유 앨범에서 뺀다 (기록을 지우며 공유 앨범에서도 빼기로 했을 때). 뺀 수를
    돌려준다."""
    removed = 0
    for album_id in albums_using(db, user_id, moment_ids):
        album = lock_album_row(db, album_id)
        if album is None:
            continue
        item_ids = list(
            db.scalars(
                select(SharedAlbumItem.id).where(
                    SharedAlbumItem.album_id == album_id,
                    SharedAlbumItem.author_id == user_id,
                    SharedAlbumItem.moment_id.in_(moment_ids),
                )
            )
        )
        remove_items(db, album, item_ids)
        removed += len(item_ids)
    return removed


def leave_all(db: Session, user_id: str) -> list[tuple[list[str], str, int]]:
    """계정 삭제 전에 모든 공유 앨범에서 나가고, 나간 앨범에 남겨 둔 사진도 지운다 (파일이
    지워진다).

    사진이 빠진 앨범마다 (남은 관리자, 앨범 이름, 빠진 사진 수)를 돌려준다. 커밋 뒤 관리자에게
    알린다.
    """
    notices: list[tuple[list[str], str, int]] = []
    album_ids = set(
        db.scalars(select(SharedAlbumMember.album_id).where(SharedAlbumMember.user_id == user_id))
    ) | set(
        db.scalars(select(SharedAlbumItem.album_id).where(SharedAlbumItem.author_id == user_id))
    )
    for album_id in sorted(album_ids):
        album = lock_album_row(db, album_id)
        if album is None:
            continue
        count = len(items_of_author(db, album_id, user_id))
        title = album.title
        if db.get(SharedAlbumMember, (album_id, user_id)) is not None:
            remove_member_rows(db, album, user_id, keep_photos=False)
        else:
            remove_items(db, album, items_of_author(db, album_id, user_id))
        if count:
            admins = list(
                db.scalars(
                    select(SharedAlbumMember.user_id).where(
                        SharedAlbumMember.album_id == album_id, SharedAlbumMember.role == "admin"
                    )
                )
            )
            if admins:
                notices.append((admins, title, count))
    return notices


# ---------------------------------------------------------------------------
# 용량이 없는 앨범 정리


def release_unfunded_album(db: Session, album: SharedAlbum) -> dict[str, list[str]]:
    """나눠 준 용량이 하나도 남지 않은 채 기한이 지난 앨범의 사진을 정리한다 (album은 잠근 상태).

    항목을 모두 빼고, 올린 사람마다 지울 수 있는 기록을 돌려준다. 파일 삭제는 올린 사람의 행을
    잠그고
    delete_unneeded_files가 한다 (잠그는 순서를 지키려고 따로 커밋한다). 구성원과 앨범은 남는다.
    """
    by_author: dict[str, list[str]] = {}
    for author_id, moment_id in db.execute(
        select(SharedAlbumItem.author_id, SharedAlbumItem.moment_id).where(
            SharedAlbumItem.album_id == album.id
        )
    ).all():
        by_author.setdefault(author_id, []).append(moment_id)
    remove_items(db, album, items_of_author_all(db, album.id))
    album.bytes_total = 0
    album.unfunded_since = None
    album.unfunded_notified_at = None
    return by_author


def items_of_author_all(db: Session, album_id: str) -> list[str]:
    return list(db.scalars(select(SharedAlbumItem.id).where(SharedAlbumItem.album_id == album_id)))


def delete_unneeded_files(db: Session, user_id: str, moment_ids: list[str]) -> list[str]:
    """정리한 앨범의 파일 중 지울 것을 deleting으로 바꾼다 (사용자 행을 잠근 상태). 지운 기록을
    돌려준다.

    올린 사람이 아직 구독(유예 포함) 중이면 남긴다: 개인 사용량으로 돌아가 그 사람의 기기가
    판단한다.
    다른 공유 앨범이 아직 쓰는 파일도 남긴다 (그 앨범이 용량이 없으면 그 앨범을 정리할 때 지운다).
    """
    if is_counted(db, user_id):
        return []
    needs = shared_needs(db, user_id, moment_ids)
    objects = db.scalars(
        select(CloudObject).where(
            CloudObject.user_id == user_id,
            CloudObject.moment_id.in_(moment_ids),
            CloudObject.status.in_(("stored", "pending")),
        )
    ).all()
    usage = db.get(Usage, user_id)
    released = []
    for obj in objects:
        if any(obj.variant in variants for variants in needs.get(obj.moment_id, {}).values()):
            continue
        if obj.status == "stored" and usage is not None:
            usage.bytes_total -= obj.size_bytes
            usage.object_count -= 1
        obj.status = "deleting"
        released.append(obj.moment_id)
    return sorted(set(released))
