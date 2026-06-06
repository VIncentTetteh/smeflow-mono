"""Agent Network ORM models: Agent, AgentPayoutBatch, AgentCommission, OnboardingReferral."""

from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

# Re-export for explicit import in other modules
__all__ = [
    "Agent",
    "AgentApplication",
    "AgentCommission",
    "AgentPayoutBatch",
    "AgentTarget",
    "CommissionRateConfig",
    "OnboardingReferral",
]

from apps.api.core.database import Base

# Commission hold period in hours before funds become available for payout
COMMISSION_HOLD_HOURS = 48


class AgentPayoutBatch(Base):
    """
    Tracks each Paystack Bulk Transfer run for agent commission payouts.

    Status machine:
      pending → processing → completed | partial_failed | failed
    """

    __tablename__ = "agent_payout_batches"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    # Null = automated Beat task; set when manually triggered by an admin
    initiated_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    agent_count: Mapped[int] = mapped_column(Integer, nullable=False)
    transfer_count: Mapped[int] = mapped_column(Integer, nullable=False)
    # Top-level reference from Paystack bulk_transfer response
    paystack_batch_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # pending | processing | completed | partial_failed | failed
    status: Mapped[str] = mapped_column(String(30), default="pending", nullable=False)
    # Per-agent results: { str(agent_id): { amount, transfer_code, status, error? } }
    results: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    commissions: Mapped[list["AgentCommission"]] = relationship(back_populates="payout_batch")


class Agent(Base):
    """A field agent who onboards merchants and earns commissions."""

    __tablename__ = "agents"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False, unique=True, index=True
    )
    # Geographic assignment
    region: Mapped[str | None] = mapped_column(String(100))  # e.g. "Greater Accra"
    district: Mapped[str | None] = mapped_column(String(100))
    momo_phone: Mapped[str | None] = mapped_column(String(20))
    momo_provider: Mapped[str | None] = mapped_column(String(20))
    paystack_recipient_code: Mapped[str | None] = mapped_column(String(100))
    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    onboarded_count: Mapped[int] = mapped_column(default=0)
    total_commission_earned: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    # Virtual wallet balances
    pending_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    available_balance: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    total_paid_out: Mapped[Decimal] = mapped_column(Numeric(15, 2), default=Decimal("0"))
    last_payout_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Minimum GHS balance required before disbursement is triggered
    payout_threshold: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("10.00"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    referrals: Mapped[list["OnboardingReferral"]] = relationship(back_populates="agent")
    commissions: Mapped[list["AgentCommission"]] = relationship(back_populates="agent")


class AgentApplication(Base):
    """Pending application for a user who wants to become a field agent."""

    __tablename__ = "agent_applications"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    region: Mapped[str | None] = mapped_column(String(100))
    district: Mapped[str | None] = mapped_column(String(100))
    momo_phone: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    reviewed_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AgentCommission(Base):
    """Commission record earned by an agent for each onboarded merchant's activity."""

    __tablename__ = "agent_commissions"
    __table_args__ = (
        UniqueConstraint("agent_id", "business_id", "trigger", name="uq_agent_commission_trigger"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    agent_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id"), nullable=False, index=True
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    # What triggered this commission
    trigger: Mapped[str] = mapped_column(String(50), nullable=False)
    # e.g. "onboarding", "first_sale", "subscription_upgrade", "monthly_activity"
    amount: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(5), default="GHS")
    # pending | available | processing | paid | failed | reversed
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    # When the 48h hold expires and this commission becomes payable
    available_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # platform_admin user_id who authorised the payment
    paid_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    # How the payout was made: momo | manual | bank
    paid_via: Mapped[str | None] = mapped_column(String(20))
    # Link to the batch this was paid in
    payout_batch_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_payout_batches.id", ondelete="SET NULL"),
        nullable=True,
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    agent: Mapped["Agent"] = relationship(back_populates="commissions")
    payout_batch: Mapped["AgentPayoutBatch | None"] = relationship(back_populates="commissions")


class OnboardingReferral(Base):
    """Tracks which agent onboarded which merchant."""

    __tablename__ = "onboarding_referrals"
    __table_args__ = (UniqueConstraint("business_id", name="uq_referral_business"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    agent_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id"), nullable=False, index=True
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, unique=True
    )
    # Referral channel
    channel: Mapped[str] = mapped_column(String(30), default="field")  # field, qr, link
    referral_code: Mapped[str | None] = mapped_column(String(50), index=True)
    # Lifecycle
    status: Mapped[str] = mapped_column(String(30), default="registered")
    # registered, first_sale, active, churned
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    agent: Mapped["Agent"] = relationship(back_populates="referrals")


class CommissionRateConfig(Base):
    """Configurable commission rate per event type, managed by platform admins."""

    __tablename__ = "commission_rate_configs"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    event_type: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[str | None] = mapped_column(String(100))


class AgentTarget(Base):
    """Monthly onboarding target per agent, set by platform admins."""

    __tablename__ = "agent_targets"
    __table_args__ = (UniqueConstraint("agent_id", "year", "month", name="uq_agent_target_month"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    agent_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    target_count: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AgentPayoutAllocation(Base):
    """
    Per-agent record within a payout batch.
    Replaces the slow JSONB scan in AgentPayoutBatch.results.
    """

    __tablename__ = "agent_payout_allocations"
    __table_args__ = (UniqueConstraint("batch_id", "agent_id", name="uq_allocation_batch_agent"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    batch_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("agent_payout_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount_ghs: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    transfer_code: Mapped[str | None] = mapped_column(String(100))
    # pending | success | failed
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    payout_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
