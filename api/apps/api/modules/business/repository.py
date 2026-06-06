"""Business repository — DB queries."""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from apps.api.modules.business.models import Business, BusinessMember, MoMoAccount


class BusinessRepository:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_by_id(self, business_id: UUID) -> Business | None:
        result = await self.db.execute(
            select(Business)
            .where(Business.id == business_id, Business.is_active.is_(True))
            .options(selectinload(Business.momo_accounts))
        )
        return result.scalar_one_or_none()

    async def get_by_owner(self, owner_id: UUID) -> list[Business]:
        result = await self.db.execute(
            select(Business).where(Business.owner_id == owner_id, Business.is_active.is_(True))
        )
        return list(result.scalars().all())

    async def get_memberships_for_user(self, user_id: UUID) -> list[BusinessMember]:
        result = await self.db.execute(
            select(BusinessMember)
            .join(Business, Business.id == BusinessMember.business_id)
            .where(
                BusinessMember.user_id == user_id,
                BusinessMember.is_active.is_(True),
                Business.is_active.is_(True),
            )
            .options(selectinload(BusinessMember.business))
            .order_by(BusinessMember.joined_at)
        )
        return list(result.scalars().all())

    async def get_by_owner_and_name(self, owner_id: UUID, name: str) -> Business | None:
        """Case-insensitive lookup for duplicate-name detection before insert."""
        result = await self.db.execute(
            select(Business).where(
                Business.owner_id == owner_id,
                func.lower(Business.name) == name.strip().lower(),
                Business.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_tin(self, tin: str) -> Business | None:
        """Global TIN lookup — TIN is unique per business entity in Ghana."""
        result = await self.db.execute(
            select(Business).where(Business.tin == tin, Business.is_active.is_(True))
        )
        return result.scalar_one_or_none()

    async def create(self, owner_id: UUID, **kwargs: object) -> Business:
        """
        Plain insert — the service's pre-flight checks (get_by_owner_and_name /
        get_by_tin) prevent duplicates in the normal path.  Any edge-case
        IntegrityError (e.g. concurrent double-tap after migration adds DB
        constraints) bubbles up to the global handler which maps it to a 409.
        """
        business = Business(owner_id=owner_id, **kwargs)
        self.db.add(business)
        await self.db.flush([business])
        return business

    async def update(self, business: Business, **kwargs: object) -> Business:
        for k, v in kwargs.items():
            if v is not None:
                setattr(business, k, v)
        await self.db.flush([business])
        return business

    async def add_member(self, business_id: UUID, user_id: UUID, role: str) -> BusinessMember:
        """
        Upsert a business member.  Uses ON CONFLICT DO NOTHING so concurrent
        invite requests for the same user never produce an IntegrityError or a
        duplicate row (BusinessMember already has uq_business_member constraint).
        """
        stmt = (
            pg_insert(BusinessMember)
            .values(business_id=business_id, user_id=user_id, role=role)
            .on_conflict_do_nothing(index_elements=["business_id", "user_id"])
            .returning(BusinessMember)
        )
        result = await self.db.execute(stmt)
        member = result.scalar_one_or_none()
        if member is None:
            # Member already existed — reload so callers always get a live instance.
            result = await self.db.execute(
                select(BusinessMember).where(
                    BusinessMember.business_id == business_id,
                    BusinessMember.user_id == user_id,
                )
            )
            member = result.scalar_one()
        return member

    async def get_member(self, business_id: UUID, user_id: UUID) -> BusinessMember | None:
        result = await self.db.execute(
            select(BusinessMember).where(
                BusinessMember.business_id == business_id,
                BusinessMember.user_id == user_id,
                BusinessMember.is_active.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def get_member_by_id(self, business_id: UUID, member_id: UUID) -> BusinessMember | None:
        result = await self.db.execute(
            select(BusinessMember)
            .where(
                BusinessMember.id == member_id,
                BusinessMember.business_id == business_id,
            )
            .options(selectinload(BusinessMember.user))
        )
        return result.scalar_one_or_none()

    async def get_members(self, business_id: UUID) -> list[BusinessMember]:
        result = await self.db.execute(
            select(BusinessMember)
            .where(BusinessMember.business_id == business_id, BusinessMember.is_active.is_(True))
            .options(selectinload(BusinessMember.user))
        )
        return list(result.scalars().all())

    async def update_member(self, member: BusinessMember, **kwargs: object) -> BusinessMember:
        for key, value in kwargs.items():
            if value is not None:
                setattr(member, key, value)
        await self.db.flush([member])
        return member

    async def add_momo_account(self, business_id: UUID, **kwargs: object) -> MoMoAccount:
        """
        Upsert a MoMo account.  ON CONFLICT (business_id, provider, phone) DO UPDATE
        so re-adding the same provider+phone updates the record rather than creating
        a duplicate (requires uq_momo_account constraint on the table).
        """
        # If is_primary=True, demote any current primary first.
        if kwargs.get("is_primary"):
            existing = await self.db.execute(
                select(MoMoAccount).where(
                    MoMoAccount.business_id == business_id,
                    MoMoAccount.is_primary.is_(True),
                )
            )
            for acc in existing.scalars().all():
                acc.is_primary = False
            await self.db.flush()

        insert_stmt = pg_insert(MoMoAccount).values(business_id=business_id, **kwargs)
        # On conflict, refresh all supplied fields from the EXCLUDED pseudo-table.
        # Uses index_elements (column inference) rather than a named constraint so
        # it works regardless of what the constraint is called.
        update_fields = {k: insert_stmt.excluded[k] for k in kwargs}
        upsert_stmt = insert_stmt.on_conflict_do_update(
            index_elements=["business_id", "provider", "phone"],
            set_=update_fields,
        ).returning(MoMoAccount)
        result = await self.db.execute(upsert_stmt)
        return result.scalar_one()

    async def get_momo_account(self, business_id: UUID, account_id: UUID) -> MoMoAccount | None:
        result = await self.db.execute(
            select(MoMoAccount).where(
                MoMoAccount.id == account_id,
                MoMoAccount.business_id == business_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_momo_account(self, account: MoMoAccount, **kwargs: object) -> MoMoAccount:
        if kwargs.get("is_primary"):
            existing = await self.db.execute(
                select(MoMoAccount).where(
                    MoMoAccount.business_id == account.business_id,
                    MoMoAccount.is_primary.is_(True),
                    MoMoAccount.id != account.id,
                )
            )
            for acc in existing.scalars().all():
                acc.is_primary = False
        for key, value in kwargs.items():
            if value is not None:
                setattr(account, key, value)
        await self.db.flush([account])
        return account

    async def delete_momo_account(self, account: MoMoAccount) -> None:
        await self.db.delete(account)
        await self.db.flush()
