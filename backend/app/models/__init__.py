# 모든 모델을 여기서 import 해야 Alembic autogenerate가 테이블을 인식한다.
from app.db import Base

__all__ = ["Base"]
