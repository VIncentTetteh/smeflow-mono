# SMEflow Merchant Settlement System — Implementation Plan

**Version:** 1.0  
**Date:** June 2026  
**Currency:** GHS (Ghana Cedis)  
**Payment Rail:** Paystack Ghana (Bulk Transfer → MoMo / Bank)  
**Scope:** Merchant sales revenue settlement · Platform fee deduction · Admin controls · Auto-settlement

---

## 1. The Problem

When a merchant's customer pays an invoice or sale via MoMo through SMEflow's Paystack integration, the collected funds land in **SMEflow's Paystack balance** — not the merchant's bank or wallet. There is currently no mechanism for:

- Tracking how much each merchant is owed from their collected sales
- Allowing merchants to request a withdrawal of their balance
- Automatically settling merchants on a schedule
- Deducting SMEflow's platform fee before settlement

This means merchant revenue is silently trapped in SMEflow's Paystack account with no path out.

---

## 2. What Already Exists (Don't Rebuild)

| Asset | Location | Relevance |
|---|---|---|
| `Payment` model with `type=collection` | `modules/payments/models.py` | Source of truth for collected funds per business |
| `MoMoAccount` with `is_verified`, `is_primary` | `modules/business/models.py` | Settlement destination already captured |
| DVA fields on `Business` | `modules/business/models.py` | Bank transfer alternative to MoMo |
| `PaystackClient.disburse()` | `libs/payment_clients/paystack.py` | Transfer mechanism already implemented |
| `PaystackClient.bulk_transfer()` | same | Batch settlement already available |
| `PaystackClient.get_balance()` | same | Platform balance check available |
| Webhook handler (`charge.success`) | `modules/payments/router.py` | Already marks `Payment.status = success` |
| `reconcile_confirmed_payment()` | `workers/tasks/payment_tasks.py` | Already links payments to invoices/sales |
| Audit log (`core/audit.py`) | `apps/api/core/audit.py` | Already implemented |
| KYC status on `KYCVerification` | `modules/kyc/models.py` | Gate settlements behind KYC |

**Critical insight:** Every successful MoMo collection already creates a `Payment` record with `type=collection` and `status=success` and `business_id`. The ledger data is already there — we just need to aggregate it and build the settlement layer on top.

---

## 3. How Settlement Works (Target Model)

```
Customer pays invoice via MoMo
        │
        ▼
  Payment(type=collection, status=success, amount=GHS X)
        │
        ▼  [webhook: charge.success — already fires]
  Ledger credit: MerchantLedgerEntry(type=credit, amount=GHS X)
  Business.unsettled_balance += X
        │
        ▼  [platform fee deducted]
  MerchantLedgerEntry(type=fee, amount=GHS fee)
  Business.unsettled_balance -= fee
        │
        ▼  [either auto-settlement T+1 or merchant request]
  MerchantSettlementRequest(status=approved)
        │
        ▼  [Paystack Bulk Transfer → merchant MoMo / bank]
  MerchantLedgerEntry(type=debit, amount=GHS settlement)
  Business.unsettled_balance -= settlement
  Business.total_settled += settlement
        │
        ▼  [Paystack webhook: transfer.success]
  MerchantSettlementRequest(status=completed)
  SMS notification to merchant
```

---

## 4. Platform Fee Structure

SMEflow deducts a **transaction fee** from every collected payment before crediting the merchant's settleable balance. Recommended rates (configurable):

| Subscription Plan | Transaction Fee |
|---|---|
| Free | 2.5% |
| Starter | 1.5% |
| Pro | 1.0% |

**Why not take the fee at collection time via Paystack Splits?**  
Splits require a subaccount per merchant. Ghana has ~100,000+ SMEs — provisioning a subaccount for every merchant upfront is operationally expensive and Paystack has rate limits. The ledger deduction approach is simpler, scales better, and is standard for SME platforms (Flutterwave, Paystack Storefront, Hubtel).

**Paystack's own collection fee (~1.5% capped at GHS 2,000)** is already deducted from SMEflow's balance by Paystack. The platform fee above is SMEflow's cut on top.

---

## 5. Settlement Modes

### Mode A — Merchant-Requested Settlement
Merchant submits a withdrawal request from the app specifying amount and destination (primary MoMo wallet). Admin reviews and approves (or auto-approves below a threshold). Platform fires Paystack Transfer.

### Mode B — Auto-Settlement (T+1)
Celery Beat task runs daily at 08:00 WAT. For every merchant with `unsettled_balance >= settlement_threshold` (default GHS 50), it auto-creates and auto-approves a settlement request and fires the transfer — no admin involvement needed for amounts below the auto-approval ceiling (default GHS 5,000).

Amounts above the ceiling go into a **pending admin review** queue.

### Mode C — On-Demand Admin Settlement
Admin can trigger settlement for a specific merchant or a batch of merchants directly from the admin portal. Used for manual corrections, end-of-month sweeps, or merchant complaints.

---

## 6. Database Changes

### Migration 0040 — Business settlement wallet fields

Add to `businesses` table:
```sql
unsettled_balance     NUMERIC(15,2) DEFAULT 0.00  -- earned but not yet settled
total_settled         NUMERIC(15,2) DEFAULT 0.00  -- lifetime settled out
settlement_threshold  NUMERIC(10,2) DEFAULT 50.00 -- min balance before auto-settlement triggers
settlement_enabled    BOOLEAN       DEFAULT TRUE   -- admin can disable per-merchant
paystack_recipient_code VARCHAR(100)               -- Paystack transfer recipient for this business
last_settled_at       TIMESTAMPTZ
```

### Migration 0041 — Merchant ledger entries

```sql
CREATE TABLE merchant_ledger_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id),
  payment_id       UUID REFERENCES payments(id),        -- source collection payment
  settlement_id    UUID REFERENCES merchant_settlements(id),
  type             VARCHAR(20) NOT NULL,  -- credit | fee | debit | reversal | adjustment
  amount           NUMERIC(15,2) NOT NULL,
  balance_after    NUMERIC(15,2) NOT NULL,              -- running balance snapshot
  description      VARCHAR(500),
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ix_merchant_ledger_business_id ON merchant_ledger_entries(business_id);
CREATE INDEX ix_merchant_ledger_created_at  ON merchant_ledger_entries(created_at);
CREATE INDEX ix_merchant_ledger_payment_id  ON merchant_ledger_entries(payment_id);
```

### Migration 0042 — Merchant settlements table

```sql
CREATE TABLE merchant_settlements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES businesses(id),
  requested_by          UUID REFERENCES users(id),     -- null = auto-settlement
  approved_by           UUID REFERENCES users(id),     -- null = auto-approved
  amount                NUMERIC(15,2) NOT NULL,        -- gross amount to settle
  fee_amount            NUMERIC(15,2) NOT NULL DEFAULT 0,
  net_amount            NUMERIC(15,2) NOT NULL,        -- amount actually transferred
  destination_phone     VARCHAR(20),
  destination_provider  VARCHAR(20),                   -- mtn, vodafone, airteltigo
  paystack_transfer_code VARCHAR(100),                 -- from Paystack /transfer response
  paystack_reference    VARCHAR(100) UNIQUE,           -- deterministic ref for idempotency
  -- pending | approved | processing | completed | failed | cancelled
  status                VARCHAR(30) NOT NULL DEFAULT 'pending',
  mode                  VARCHAR(20) DEFAULT 'manual',  -- manual | auto | admin
  failure_reason        VARCHAR(500),
  requested_at          TIMESTAMPTZ DEFAULT now(),
  approved_at           TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ix_merchant_settlements_business_id ON merchant_settlements(business_id);
CREATE INDEX ix_merchant_settlements_status      ON merchant_settlements(status);
CREATE INDEX ix_merchant_settlements_transfer_code ON merchant_settlements(paystack_transfer_code);
```

**Note:** `merchant_ledger_entries` references `merchant_settlements`, so migration 0042 must run before migration 0041's FK constraint is applied. Create 0042 first, then 0041 with the FK — same pattern used for agent_payout_batches.

---

## 7. Service Layer: `MerchantSettlementService`

New file: `apps/api/modules/settlements/service.py`

```python
async def credit_collection(self, payment_id: UUID) -> MerchantLedgerEntry:
    """
    Called by the charge.success webhook handler after a collection is confirmed.
    Calculates platform fee, creates two ledger entries (credit + fee),
    updates business.unsettled_balance.
    Idempotent — skips if a ledger entry already exists for this payment_id.
    """

async def get_merchant_balance(self, business_id: UUID) -> dict:
    """
    Returns { unsettled_balance, total_settled, last_settled_at,
              settlement_threshold, recent_ledger_entries }.
    """

async def request_settlement(
    self, business_id: UUID, amount: Decimal, requested_by: UUID
) -> MerchantSettlement:
    """
    Merchant-initiated settlement request.
    Validates:
      - amount <= unsettled_balance
      - amount >= MIN_SETTLEMENT_GHS (default GHS 10)
      - KYC is verified
      - No pending settlement already in flight for this business
      - Primary verified MoMo account exists
    Creates MerchantSettlement(status=pending).
    If amount < AUTO_APPROVE_CEILING: auto-approves and calls _disburse_settlement().
    Otherwise: leaves for admin review.
    """

async def approve_settlement(
    self, settlement_id: UUID, admin_id: UUID
) -> MerchantSettlement:
    """
    Admin approves a pending settlement request.
    Calls _disburse_settlement().
    """

async def cancel_settlement(
    self, settlement_id: UUID, actor_id: UUID, reason: str
) -> MerchantSettlement:
    """
    Cancel a pending settlement. Releases the hold on unsettled_balance.
    """

async def confirm_settlement(self, paystack_transfer_code: str) -> MerchantSettlement | None:
    """
    Called by webhook on transfer.success.
    Marks settlement completed, creates debit ledger entry,
    updates business.unsettled_balance and total_settled.
    Notifies merchant via SMS + in-app.
    """

async def fail_settlement(
    self, paystack_transfer_code: str, reason: str
) -> MerchantSettlement | None:
    """
    Called by webhook on transfer.failed / transfer.reversed.
    Reverts settlement to 'failed', releases balance hold.
    Schedules retry if auto-settlement, notifies admin if manual.
    """

async def prepare_auto_settlement_batch(self) -> list[dict]:
    """
    Called by daily Beat task.
    Selects all active, KYC-verified merchants with:
      unsettled_balance >= settlement_threshold
      settlement_enabled = True
      No pending settlement in flight
    Returns list of { business_id, amount, net_amount, recipient_code, reference }.
    """

async def ensure_merchant_recipient_code(self, business: Business) -> str:
    """
    Returns business.paystack_recipient_code if set.
    Otherwise creates Paystack transfer recipient from primary verified MoMo account.
    Raises ValueError if no verified MoMo account exists.
    """

async def get_settlement_history(
    self, business_id: UUID, limit: int, offset: int
) -> tuple[list[MerchantSettlement], int]:
    """Paginated settlement history for a business."""

async def get_ledger(
    self, business_id: UUID, limit: int, offset: int
) -> tuple[list[MerchantLedgerEntry], int]:
    """Paginated ledger for a business — full credit/debit/fee history."""
```

### Platform fee calculation

```python
PLATFORM_FEE_RATES = {
    "free":    Decimal("0.025"),  # 2.5%
    "starter": Decimal("0.015"),  # 1.5%
    "pro":     Decimal("0.010"),  # 1.0%
}

def calculate_fee(amount: Decimal, subscription_plan: str) -> Decimal:
    rate = PLATFORM_FEE_RATES.get(subscription_plan, Decimal("0.025"))
    return (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
```

---

## 8. Webhook Integration

The existing `charge.success` handler in `modules/payments/router.py` already calls `reconcile_confirmed_payment()`. Extend it to also call `MerchantSettlementService.credit_collection()`:

```python
# In _apply_paystack_payment_update(), after reconcile_confirmed_payment():
if new_status == "success" and payment.type == "collection":
    from apps.api.modules.settlements.service import MerchantSettlementService
    await MerchantSettlementService(db).credit_collection(payment.id)
```

The payout webhook handler (`modules/payouts/webhooks.py`) already handles `transfer.success` and `transfer.failed`. Extend the dispatch logic to also check for settlement transfers:

```python
# In _handle_transfer_success():
# Path 3: Merchant settlement
from apps.api.modules.settlements.service import MerchantSettlementService
settlement = await MerchantSettlementService(db).confirm_settlement(transfer_code)
if settlement:
    return

# In _handle_transfer_failure():
# Path 3: Merchant settlement failure
settlement = await MerchantSettlementService(db).fail_settlement(transfer_code, reason)
if settlement:
    return
```

**Paystack reference naming convention for settlements:**
```
settle-{business_id[:12]}-{YYYYMMDD}
```
This is distinct from agent payout references (`payout-...`) and loan references (`loan-disb-...`), so the webhook dispatcher can route correctly.

---

## 9. Celery Tasks

New tasks in `payout_tasks.py`:

### `daily_merchant_auto_settlement`
```python
@celery.task(name="...daily_merchant_auto_settlement")
def daily_merchant_auto_settlement() -> None:
    """
    Daily at 08:00 WAT.
    Selects all eligible merchants, fires Paystack Bulk Transfer,
    creates MerchantSettlement records, schedules reconciliation.
    """
```

### `reconcile_merchant_settlement_batch`
```python
@celery.task(name="...reconcile_merchant_settlement_batch")
def reconcile_merchant_settlement_batch(batch_ref: str) -> None:
    """
    30 minutes after auto-settlement batch.
    Calls Paystack GET /transfer for any still-pending settlements.
    Safety net for missed webhooks.
    """
```

### `retry_failed_merchant_settlement`
```python
@celery.task(bind=True, max_retries=3)
def retry_failed_merchant_settlement(self, settlement_id: str) -> None:
    """
    Retry a failed settlement transfer.
    Backoff: 30m → 2h → 6h.
    After 3 failures, escalates to admin and leaves settlement in 'failed'.
    """
```

### Beat schedule addition:
```python
"daily-merchant-auto-settlement": {
    "task": "...daily_merchant_auto_settlement",
    "schedule": crontab(minute="0", hour="8"),  # 08:00 WAT daily
},
```

---

## 10. API Endpoints

### Merchant-facing (`/settlements/...`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/settlements/balance` | Unsettled balance, threshold, last settled date |
| `GET` | `/settlements/ledger` | Full credit/fee/debit history (paginated) |
| `GET` | `/settlements` | Settlement request history (paginated) |
| `POST` | `/settlements/request` | Submit a withdrawal request |
| `DELETE` | `/settlements/{id}` | Cancel a pending settlement request |

### Admin-facing (`/admin/settlements/...`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/settlements` | All settlements across all merchants (filterable by status) |
| `GET` | `/admin/settlements/pending` | Settlements awaiting admin approval |
| `POST` | `/admin/settlements/{id}/approve` | Approve a pending settlement |
| `POST` | `/admin/settlements/{id}/cancel` | Cancel with reason |
| `POST` | `/admin/settlements/trigger` | Manually trigger auto-settlement batch |
| `GET` | `/admin/settlements/summary` | Platform-level: total unsettled, liability, daily volume |
| `GET` | `/admin/merchants/{id}/balance` | Balance + ledger for a specific merchant |
| `POST` | `/admin/merchants/{id}/settle` | Force-settle a specific merchant (any amount) |
| `PATCH` | `/admin/merchants/{id}/settlement-config` | Toggle settlement_enabled, update threshold |

---

## 11. Security & Compliance Controls

### KYC gate
Settlements only allowed for merchants with `KYCVerification.status = "verified"`. Unverified merchants see their balance but get a "complete KYC to unlock settlements" message.

### Verified MoMo gate
Settlement destination must be a `MoMoAccount` where `is_verified = True` and `is_primary = True`. Merchants cannot settle to an unverified number.

### Settlement hold
No hold period on collections — funds are available the next business day (T+1). This matches standard Ghanaian mobile money market expectation.

### Auto-approval ceiling
Settlements below GHS 5,000 auto-approve and fire immediately. Above GHS 5,000 require admin sign-off. Configurable via `SETTLEMENT_AUTO_APPROVE_CEILING_GHS` env var.

### Minimum settlement amount
GHS 10 minimum per request — prevents micro-transfers that erode Paystack balance with transfer fees.

### Maximum per-request
GHS 50,000 per single settlement request — prevents large erroneous transfers. Configurable.

### Concurrent settlement lock
A business cannot have two settlements in `pending` or `processing` simultaneously. The `request_settlement()` method enforces this before creating a new request.

### Idempotency
Settlement references follow `settle-{business_id[:12]}-{YYYYMMDD}`. If a daily auto-settlement already ran today for a business, the deterministic reference prevents a duplicate transfer at Paystack level.

### Audit trail
Every state transition on `MerchantSettlement` writes an audit log entry:
- `settlement.requested`, `settlement.approved`, `settlement.processing`
- `settlement.completed`, `settlement.failed`, `settlement.cancelled`

### Bank of Ghana compliance
- 90-day ledger retention (satisfied by `merchant_ledger_entries` table)
- Platform fee must be visible on the merchant ledger — not silently skipped
- All settlement records must include: amount, fee, net, destination, timestamp, Paystack reference

---

## 12. Notification Events

| Event | Recipient | Channel |
|---|---|---|
| `settlement.credited` | Merchant | In-app (silent — no SMS for every invoice paid) |
| `settlement.requested` | Merchant + Admin | In-app |
| `settlement.approved` | Merchant | In-app + SMS |
| `settlement.processing` | Merchant | SMS ("Your GHc X.XX is on the way to 024XXXXXXX") |
| `settlement.completed` | Merchant | SMS + In-app |
| `settlement.failed` | Merchant + Admin | In-app |
| `settlement.pending_review` | Admin | In-app (amount above auto-approve ceiling) |

---

## 13. Frontend Changes

### Merchant Portal — new "Wallet" section

**Balance card:**
- Unsettled balance (GHc X.XX)
- "Withdraw" button → opens settlement request modal
- Next auto-settlement date
- Platform fee rate (shown transparently)

**Settlement request modal:**
- Amount input (min GHS 10, max = unsettled_balance)
- Destination: primary MoMo account (pre-filled, not editable — change in Settings)
- Fee preview: "Platform fee: GHc X.XX (1.5%) · You receive: GHc X.XX"
- Confirm button

**Ledger tab:**
- Table: date, type (Payment Received / Platform Fee / Settlement), amount, balance
- Filter by type and date range

**Settlement history tab:**
- Table: date, amount, destination, status, Paystack reference

### Admin Portal — "Merchant Settlements" section

**Overview cards:**
- Total merchant unsettled balance (liability)
- Pending admin approval count + total amount
- Today's auto-settlement volume

**Pending approvals table:**
- Merchant name, amount, requested at, KYC status, MoMo account
- Approve / Cancel actions per row
- Bulk approve button

**Settlement log:**
- Full history, filterable by status, merchant, date

---

## 14. Implementation Phases

### Phase 1 — Ledger foundation (Week 1)
- [ ] Migration 0040: `businesses` settlement wallet fields
- [ ] Migration 0041: `merchant_ledger_entries` table
- [ ] Migration 0042: `merchant_settlements` table
- [ ] `MerchantSettlementService.credit_collection()` + `calculate_fee()`
- [ ] Wire into existing `charge.success` webhook handler
- [ ] `MerchantSettlementService.get_merchant_balance()` + `get_ledger()`
- [ ] `GET /settlements/balance` and `GET /settlements/ledger` endpoints

### Phase 2 — Settlement requests (Week 2)
- [ ] `ensure_merchant_recipient_code()` — create Paystack recipient from primary MoMo
- [ ] `request_settlement()` with all validation gates (KYC, verified MoMo, concurrent lock, limits)
- [ ] `approve_settlement()` + `cancel_settlement()`
- [ ] `POST /settlements/request`, `DELETE /settlements/{id}`
- [ ] Webhook: `transfer.success/failed` → `confirm_settlement()` / `fail_settlement()`
- [ ] `retry_failed_merchant_settlement` task
- [ ] Merchant settlement notifications (processing, completed, failed)

### Phase 3 — Auto-settlement (Week 3)
- [ ] `prepare_auto_settlement_batch()` with eligibility filters
- [ ] `daily_merchant_auto_settlement` Celery task + 08:00 Beat schedule
- [ ] `reconcile_merchant_settlement_batch` safety-net task
- [ ] Admin trigger endpoint `POST /admin/settlements/trigger`
- [ ] Admin pending approvals queue + approve/cancel endpoints
- [ ] Admin merchant balance + force-settle endpoints

### Phase 4 — Hardening (Week 4)
- [ ] Auto-approval ceiling enforcement (`SETTLEMENT_AUTO_APPROVE_CEILING_GHS`)
- [ ] `settlement_enabled` toggle per merchant (admin can pause settlements)
- [ ] Full audit log coverage for all state transitions
- [ ] `PATCH /admin/merchants/{id}/settlement-config`
- [ ] Platform fee visibility on merchant ledger (verify fee entries created correctly)
- [ ] Admin settlement summary dashboard endpoint

---

## 15. Key Decisions & Rationale

| Decision | Rationale |
|---|---|
| Ledger model (not direct balance field) | Gives full audit trail — every credit, fee, and debit is traceable. BOG expects this. Balance field on Business is a running cache for query performance only. |
| T+1 auto-settlement (not instant) | Standard in Ghana. Gives SMEflow time to detect fraud (e.g., chargebacks on card payments, though MoMo reversals are rare) before funds leave the platform. |
| Platform fee deducted at ledger credit time | Transparent to merchant — they see the fee immediately when their customer pays, not as a surprise deduction when they withdraw. |
| Auto-approval ceiling GHS 5,000 | Balances merchant UX (most SME settlements are below this) with fraud control (large amounts warrant human review). |
| Minimum settlement GHS 10 | Paystack transfer fee is ~GHS 1–2. Settling GHS 5 would wipe out a significant chunk in fees. |
| MoMo as primary settlement channel | 85%+ of SMEflow's target merchants are mobile-money-first. Bank transfer is secondary (requires account number verification). |
| No Paystack subaccounts per merchant | Operationally simpler at scale. Subaccounts work for lenders (small number) but not for 10,000+ merchants. The ledger approach achieves the same outcome. |
| Deterministic settlement reference | Prevents duplicate transfers if the Beat task fires twice (e.g., Beat Redis failure + recovery). Paystack deduplicates by reference. |
