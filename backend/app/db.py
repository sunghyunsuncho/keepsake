from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


# connect_timeout: DB가 응답하지 않을 때 /health/ready 같은 요청이 무한정 걸려 있지 않게 한다.
engine = create_engine(
    get_settings().database_url, pool_pre_ping=True, connect_args={"connect_timeout": 5}
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
