"""Auth repository — DB queries for User model."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from apps.api.core.phone import normalize_ghana_phone
from apps.api.modules.auth.models import User


class UserRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_phone(self, phone: str) -> User | None:
        phone = normalize_ghana_phone(phone)
        result = await self.db.execute(select(User).where(User.phone == phone))
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: UUID) -> User | None:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def create(self, phone: str, name: str | None = None) -> User:
        """
        INSERT the new user, ignoring the conflict if a concurrent request already
        inserted the same phone number.  Returns the (possibly pre-existing) row.
        Using INSERT ... ON CONFLICT DO NOTHING instead of session.add() eliminates
        the SELECT-then-INSERT race that causes duplicate-user IntegrityErrors.
        """
        phone = normalize_ghana_phone(phone)
        stmt = (
            pg_insert(User)
            .values(phone=phone, name=name)
            .on_conflict_do_nothing(index_elements=["phone"])
            .returning(User)
        )
        result = await self.db.execute(stmt)
        user = result.scalar_one_or_none()
        if user is None:
            # A concurrent transaction already inserted this phone — fetch it.
            result = await self.db.execute(select(User).where(User.phone == phone))
            user = result.scalar_one()
        return user

    async def update(self, user: User, **kwargs: object) -> User:
        for k, v in kwargs.items():
            if v is not None:
                setattr(user, k, v)
        await self.db.flush([user])
        return user
