"""Auth-related ORM models."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base

if TYPE_CHECKING:
    from apps.api.modules.business.models import BusinessMember


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    phone: Mapped[str] = mapped_column(String(15), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    # Google's stable per-user "sub" claim — survives email changes on the Google side.
    google_sub: Mapped[str | None] = mapped_column(
        String(255), unique=True, nullable=True, index=True
    )
    name: Mapped[str | None] = mapped_column(String(255))
    ghana_card_id: Mapped[str | None] = mapped_column(String(50), unique=True)
    tin: Mapped[str | None] = mapped_column(String(20), unique=True)
    kyc_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unverified")
    # kyc_status values: unverified | pending | verified | rejected
    kyc_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    kyc_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Lazily generated on first /referrals/my-code call
    referral_code: Mapped[str | None] = mapped_column(String(12), unique=True, index=True)
    # Language preference: "en" (English) or "tw" (Twi)
    language_pref: Mapped[str] = mapped_column(String(5), nullable=False, server_default="en")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships — BusinessMember defined in business.models (circular avoided via string ref)
    businesses: Mapped[list["BusinessMember"]] = relationship(back_populates="user")

    @property
    def google_linked(self) -> bool:
        return self.google_sub is not None
