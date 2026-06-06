"""Referral ORM models."""

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from apps.api.core.database import Base


class Referral(Base):
    """Tracks each referral invitation from a referrer to a referee phone."""

    __tablename__ = "referrals"
    __table_args__ = (UniqueConstraint("referrer_id", "referee_phone", name="uq_referral_pair"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    referrer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    referee_phone: Mapped[str] = mapped_column(String(15), nullable=False)
    # Populated when the referee registers
    referee_user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    # pending | converted | rewarded
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    reward_granted: Mapped[bool] = mapped_column(Boolean, default=False)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
