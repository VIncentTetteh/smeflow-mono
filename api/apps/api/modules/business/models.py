"""Business ORM models: Business, BusinessMember, MoMoAccount."""

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base

if TYPE_CHECKING:
    from apps.api.modules.auth.models import User


class Business(Base):
    __tablename__ = "businesses"
    __table_args__ = (
        # One owner cannot have two businesses with the same name.
        UniqueConstraint("owner_id", "name", name="uq_business_owner_name"),
        # TIN is issued per business entity in Ghana — globally unique when provided.
        Index("uq_business_tin", "tin", unique=True, postgresql_where="tin IS NOT NULL"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    owner_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)  # market_stall, shop, artisan...
    tin: Mapped[str | None] = mapped_column(String(20))
    ghana_card_ref: Mapped[str | None] = mapped_column(String(50))
    address: Mapped[str | None] = mapped_column(String(500))
    region: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(100))
    market: Mapped[str | None] = mapped_column(String(150))
    preferred_language: Mapped[str] = mapped_column(String(10), default="en", server_default="en")
    momo_provider: Mapped[str | None] = mapped_column(String(20))
    tax_vat_status: Mapped[str] = mapped_column(
        String(30), default="unknown", server_default="unknown"
    )
    template_slug: Mapped[str | None] = mapped_column(String(80))
    location_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    location_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    subscription: Mapped[str] = mapped_column(String(20), default="free")
    sub_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ghqr_merchant_id: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    email_enabled: Mapped[bool] = mapped_column(Boolean, server_default="true", default=True)
    paystack_customer_code: Mapped[str | None] = mapped_column(String(100))
    paystack_customer_id: Mapped[int | None] = mapped_column()
    paystack_subscription_code: Mapped[str | None] = mapped_column(String(100))
    # Dedicated Virtual Account — acts as a business wallet (created on KYC approval)
    dva_id: Mapped[str | None] = mapped_column(String(100))
    dva_account_number: Mapped[str | None] = mapped_column(String(20))
    dva_account_name: Mapped[str | None] = mapped_column(String(255))
    dva_bank_name: Mapped[str | None] = mapped_column(String(100))
    # Settlement wallet — tracks collected revenue awaiting withdrawal
    unsettled_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_settled: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    settlement_threshold: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), default=Decimal("50.00")
    )
    settlement_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    paystack_recipient_code: Mapped[str | None] = mapped_column(String(100))
    last_settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    members: Mapped[list["BusinessMember"]] = relationship(
        back_populates="business", cascade="all, delete-orphan"
    )
    momo_accounts: Mapped[list["MoMoAccount"]] = relationship(
        back_populates="business", cascade="all, delete-orphan"
    )


class BusinessMember(Base):
    __tablename__ = "business_members"
    __table_args__ = (
        UniqueConstraint("business_id", "user_id", name="uq_business_member"),
        CheckConstraint(
            "role IN ('owner', 'manager', 'staff')",
            name="ck_business_member_role",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(30), nullable=False)  # owner, manager, staff
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    business: Mapped["Business"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship()


class MoMoAccount(Base):
    __tablename__ = "momo_accounts"
    __table_args__ = (UniqueConstraint("business_id", "provider", "phone", name="uq_momo_account"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False)  # mtn, vodafone, airteltigo
    phone: Mapped[str] = mapped_column(String(15), nullable=False)
    account_name: Mapped[str | None] = mapped_column(String(255))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, verified, failed
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_ref: Mapped[str | None] = mapped_column(String(100))
    failure_reason: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    business: Mapped["Business"] = relationship(back_populates="momo_accounts")
