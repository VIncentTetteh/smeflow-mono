"""Credit scoring ORM models."""

from datetime import datetime
from decimal import Decimal
from typing import ClassVar
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from apps.api.core.database import Base


class CreditScore(Base):
    __tablename__ = "credit_scores"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    band: Mapped[str] = mapped_column(String(5), nullable=False)  # A, B, C, D, E
    max_loan_amount: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    factors: Mapped[dict] = mapped_column(JSONB, default=dict)

    # Transient flag set by the service layer; never persisted
    staleness_warning: bool = False


class LoanRequest(Base):
    """
    Full loan lifecycle.

    Status machine
    ─────────────
    pending_partner   — merchant submitted request, awaiting lender decision
    approved          — lender approved; OTP sent to merchant for confirmation
    rejected          — lender declined
    confirmed         — merchant confirmed via OTP; ready for disbursement
    disbursing        — MoMo payment initiated
    active            — funds disbursed; repayment schedule running
    repaid            — all instalments paid
    defaulted         — one or more instalments unrecoverable
    cancelled         — merchant or admin cancelled before disbursement
    """

    __tablename__ = "loan_requests"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    credit_score_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("credit_scores.id")
    )
    amount_requested: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    amount_approved: Mapped[Decimal | None] = mapped_column(Numeric(15, 2))
    term_days: Mapped[int | None]
    interest_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))

    # Which lender is handling this request
    lender_id: Mapped[str | None] = mapped_column(String(100), index=True)
    # Lender's own reference for this loan (used for reconciliation)
    partner_ref: Mapped[str | None] = mapped_column(String(100))
    # URL to POST repayment / status events back to the lender
    lender_webhook_url: Mapped[str | None] = mapped_column(Text)
    # Lender's decline reason
    rejection_reason: Mapped[str | None] = mapped_column(Text)

    # MoMo phone + payment reference for disbursement
    disbursement_phone: Mapped[str | None] = mapped_column(String(20))
    disbursement_payment_ref: Mapped[str | None] = mapped_column(String(100))
    # Paystack transfer_code returned from /transfer — used to match webhook events
    disbursement_transfer_code: Mapped[str | None] = mapped_column(String(100), index=True)

    status: Mapped[str] = mapped_column(String(30), default="pending_partner", index=True)

    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disbursed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    repaid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    defaulted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    instalments: Mapped[list["RepaymentInstalment"]] = relationship(
        back_populates="loan", order_by="RepaymentInstalment.due_date"
    )

    _transitions: ClassVar[dict[str, set[str]]] = {
        "pending_partner": {"approved", "rejected", "cancelled"},
        "approved": {"confirmed", "cancelled"},
        "rejected": set(),
        "confirmed": {"disbursing", "cancelled"},
        "disbursing": {"active", "confirmed"},
        "active": {"repaid", "defaulted"},
        "repaid": set(),
        "defaulted": set(),
        "cancelled": set(),
    }

    def transition(self, new_status: str) -> tuple[str, str]:
        allowed = self._transitions.get(self.status, set())
        if new_status not in allowed:
            from apps.api.core.exceptions import ConflictError

            raise ConflictError(
                f"Loan {self.id} cannot transition from '{self.status}' to '{new_status}'"
            )
        old_status = self.status
        self.status = new_status
        return old_status, new_status


class RepaymentInstalment(Base):
    """
    One periodic instalment in a loan's repayment schedule.

    Status machine
    ─────────────
    pending      — due date not yet reached
    collecting   — Celery job has triggered a MoMo collection attempt
    paid         — payment confirmed
    failed       — collection attempt failed (will retry next day, up to 3 times)
    defaulted    — >3 days overdue and collection exhausted
    """

    __tablename__ = "repayment_instalments"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    loan_request_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("loan_requests.id"), nullable=False, index=True
    )
    instalment_number: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)

    # Amounts in GHS
    amount: Mapped[Decimal] = mapped_column(
        Numeric(15, 2), nullable=False
    )  # total = principal + interest
    principal: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)
    interest: Mapped[Decimal] = mapped_column(Numeric(15, 2), nullable=False)

    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)

    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    payment_ref: Mapped[str | None] = mapped_column(String(100))
    # Paystack transaction reference for this repayment charge
    paystack_ref: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    # Paystack split_code used on this charge (lender revenue split)
    split_code_used: Mapped[str | None] = mapped_column(String(100))
    # Internal Payment record id
    payment_id: Mapped[str | None] = mapped_column(String(100))

    # Collection retry tracking
    collection_attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    loan: Mapped["LoanRequest"] = relationship(back_populates="instalments")


class LenderConsent(Base):
    """Business opt-in consent for a specific lender partner to access their credit profile."""

    __tablename__ = "lender_consents"
    __table_args__ = (UniqueConstraint("business_id", "lender_id", name="uq_lender_consent"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    business_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("businesses.id"), nullable=False, index=True
    )
    lender_id: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    consented_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
