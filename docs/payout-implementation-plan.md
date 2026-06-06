# SMEflow Payout System — End-to-End Implementation Plan

**Version:** 1.0  
**Date:** June 2026  
**Currency:** GHS (Ghana Cedis)  
**Payment Rail:** Paystack Ghana  
**Scope:** Agent commission payouts · Merchant loan disbursements · Lender revenue splits

---

## 1. Overview

SMEflow operates with four financial entities: **Platform**, **Agents**, **Merchants (Businesses)**, and **Lenders**. Money flows in three directions:

```
Customer / Merchant ──── pays ────▶ Paystack (collected)
                                        │
                   ┌────────────────────┼────────────────────────┐
                   ▼                    ▼                         ▼
            Agent Wallet          Platform Balance         Lender Subaccount
          (commissions)           (subscription fees,      (loan repayment
                                   platform margin)         revenue split)
                   │
                   ▼
         Weekly MoMo Bulk Transfer
            to Agent's wallet
```

This plan implements a **virtual ledger + batch disbursement** model — the industry standard used by Flutterwave, Paystack Commerce, and comparable African fintech platforms. It replaces the current ad-hoc manual payout with a fully automated, auditable, idempotent pipeline.

---

## 2. Current State

| Area | Status | Gap |
|---|---|---|
| Paystack MoMo collection | ✅ Implemented | — |
| Paystack Bulk Transfer client | ✅ Implemented | Not scheduled |
| Agent `paystack_recipient_code` field | ✅ Migration 0029 | Not pre-created at registration |
| `payout_commissions_via_paystack()` | ✅ Implemented | Manually triggered only |
| Agent commission ledger / balance | ❌ Missing | No `available` vs `pending` concept |
| Payout hold period | ❌ Missing | Commissions paid immediately |
| Merchant loan disbursement webhook | ⚠️ Partial | Status transition exists, payout not confirmed by webhook |
| Lender revenue split at collection | ⚠️ Model exists | `paystack_split_code` on `LenderPartner` not wired to repayment collection |
| Admin payout dashboard | ❌ Missing | No UI to review/approve batches |
| Agent payout history UI | ❌ Missing | Commissions page shows status, no payout detail |
| Automated weekly payout Beat task | ❌ Missing | No scheduled agent disbursement |

---

## 3. Architecture: Two-Rail Model

### Rail 1 — Collections (inbound)
All money enters through Paystack. Three collection methods:
- **MoMo prompt** (`POST /charge`) — subscription fees, invoice payments, loan repayments
- **Dedicated Virtual Account (DVA)** — bank transfers into merchant accounts
- **GH-QR** — point-of-sale QR payments

### Rail 2 — Disbursements (outbound)
Money leaves through two mechanisms:
- **Paystack Splits** — splits at collection time, zero additional transfer fee, atomic (lender revenue share on repayments)
- **Paystack Bulk Transfer** — batched transfers from platform balance (agent commissions, loan disbursements to merchants)

**Why this split:**
- Splits are better for lenders because revenue is separated before it ever enters the platform balance — clean, no reconciliation needed.
- Bulk Transfers are better for agents because commissions accumulate over time and should be batched weekly to reduce per-transfer fees and enable a hold period.

---

## 4. Entity-by-Entity Design

---

### 4.1 Agents

#### How agents earn money
Agents earn fixed GHS commissions per trigger event:

| Trigger | Default Rate |
|---|---|
| `onboarding` | GHS 5.00 |
| `first_sale` | GHS 10.00 |
| `subscription_upgrade` | GHS 20.00 |
| `first_loan` | GHS 30.00 |
| `monthly_activity` | GHS 3.00 |

#### Problem with current model
Commissions are created with `status=pending` and paid by manually calling `payout_commissions_via_paystack()`. There is no hold period, no minimum threshold, no scheduled disbursement, and no agent-facing balance summary.

#### Target model: Virtual Wallet

Each agent has a virtual wallet with two buckets:
- **`pending_balance`** — commissions earned but within hold period (not yet payable)
- **`available_balance`** — commissions past hold period, ready for disbursement

Disbursement happens weekly (Fridays, 10:00 WAT) via Celery Beat → Paystack Bulk Transfer.

#### Commission status machine

```
created ──▶ pending (hold period: 48h)
               │
               ▼ (hold expires + balance ≥ threshold)
           available ──▶ processing ──▶ paid
                                  │
                                  ▼ (transfer failed)
                               failed ──▶ available (retry next cycle)
```

#### New fields required (Migration 0034)

On `agents` table:
```sql
pending_balance     NUMERIC(15,2) DEFAULT 0.00
available_balance   NUMERIC(15,2) DEFAULT 0.00
total_paid_out      NUMERIC(15,2) DEFAULT 0.00
last_payout_at      TIMESTAMPTZ
payout_threshold    NUMERIC(10,2) DEFAULT 10.00  -- minimum GHS before disbursement
```

On `agent_commissions` table:
```sql
available_at        TIMESTAMPTZ   -- when hold period expires (created_at + 48h)
payout_batch_id     UUID          -- links to AgentPayoutBatch
```

#### New model: `AgentPayoutBatch`

Tracks each bulk transfer run:
```
id, initiated_by (admin user_id), total_amount, agent_count,
transfer_count, paystack_batch_ref, status (pending|processing|completed|partial_failed),
created_at, completed_at, metadata (JSONB — per-agent results)
```

#### Paystack recipient code — create at registration
Currently created lazily at payout time. Change: create the Paystack recipient immediately when an agent sets their `momo_phone` + `momo_provider`. Store `paystack_recipient_code` then. Validate the code is live before the agent's first payout.

#### Payout schedule
- **Frequency:** Weekly, Fridays 10:00 WAT
- **Minimum threshold:** GHS 10.00 (configurable per agent)
- **Hold period:** 48 hours (fraud buffer — allows reversal of disputed commissions)
- **Batch size:** Up to 100 per Paystack Bulk Transfer call (Paystack limit)
- **OTP requirement:** Paystack requires OTP for transfers > GHS 1,000 — batch splits if needed

#### Agent-facing features
- Dashboard: `pending_balance`, `available_balance`, `next_payout_date`
- Payout history: each `AgentPayoutBatch` entry with amount, date, transfer code
- Commission breakdown: per-trigger earnings table

---

### 4.2 Merchants (Businesses)

Merchants receive money in two scenarios:

#### Scenario A — Loan Disbursement

Flow:
```
Lender approves loan
  → LoanRequest.status = "confirmed"
  → Admin or auto-trigger initiates disbursement
  → PaystackClient.disburse() → MoMo transfer to merchant's disbursement_phone
  → Paystack webhook: transfer.success / transfer.failed
  → LoanRequest.status = "active" / "confirmed" (retry)
```

**Current gap:** The webhook handler for `transfer.success` / `transfer.failed` doesn't update `LoanRequest` status or notify the merchant. This needs to be wired.

**New `disbursement_transfer_code` field on `LoanRequest`** — stores the Paystack transfer code from the `/transfer` response so the webhook can match it back.

**Idempotency:** Store `disbursement_payment_ref` (already exists) as the Paystack transfer reference. If the transfer is re-attempted (e.g., after failure), reuse the same reference — Paystack deduplicates by reference.

#### Scenario B — Subscription / Invoice Settlement (Inbound only)

Merchants don't receive money here — they pay. No changes needed. DVA handles inbound bank transfers. GH-QR and MoMo prompt handle POS collections.

#### Merchant-facing features
- Loan disbursement status notification (SMS + in-app) when funds are sent
- Failed disbursement retry prompt in admin
- Disbursement history tab in merchant loan view

---

### 4.3 Lenders

Lenders earn revenue from loan repayments. The platform takes a `platform_fee_percent` cut (already on `LenderPartner` model).

#### Current state
`LenderPartner.paystack_subaccount_code` and `paystack_split_code` exist but are not wired to repayment collection.

#### Target model: Split at collection time

When a merchant repays a loan instalment via MoMo:
1. Paystack charge is initiated with `split_code` attached
2. Paystack automatically routes `(100 - platform_fee_percent)%` to lender's subaccount
3. Platform retains `platform_fee_percent`
4. No second transfer needed — split is atomic

**Setup flow (one-time per lender):**
1. Admin creates `LenderPartner` with `settlement_bank_code` + `settlement_account_number`
2. System calls `PaystackClient.create_subaccount()` → stores `paystack_subaccount_code`
3. System calls `PaystackClient.create_split()` → stores `paystack_split_code`
4. All repayment charges for that lender's loans use this `split_code`

#### Webhook — `charge.success` on repayment
On repayment charge success:
1. Find `RepaymentInstalment` by payment reference
2. Mark instalment paid
3. Check if all instalments paid → mark `LoanRequest.status = "repaid"`
4. Create `LenderLoanRevenue` record (already modelled)
5. Notify lender via webhook (`lender_webhook_url`)
6. Notify merchant (repayment confirmed)

#### Lender subaccount auto-setup
Add a service method `LenderService.setup_paystack_subaccount(lender_id)` that:
- Creates customer → subaccount → split in sequence
- Is idempotent (skips steps already done)
- Can be triggered from admin portal and via API

#### Lender-facing features (portal)
- Revenue dashboard: total earned, per-loan breakdown
- Split code status indicator
- Manual subaccount setup trigger if auto-setup failed

---

### 4.4 Platform

The platform retains its cut implicitly:
- **Subscription fees** → full amount stays in Paystack balance
- **Repayment splits** → `platform_fee_percent` stays in balance after split
- **Agent commissions** → disbursed from balance weekly

No special model needed — the Paystack balance is the platform's treasury. The admin dashboard should show:
- Current Paystack balance (via `GET /balance`)
- Pending commission liabilities (sum of `available_balance` across all agents)
- Weekly payout forecast

---

## 5. Database Changes

### Migration 0034 — Agent virtual wallet

```python
# agents table
op.add_column("agents", sa.Column("pending_balance", Numeric(15, 2), server_default="0.00"))
op.add_column("agents", sa.Column("available_balance", Numeric(15, 2), server_default="0.00"))
op.add_column("agents", sa.Column("total_paid_out", Numeric(15, 2), server_default="0.00"))
op.add_column("agents", sa.Column("last_payout_at", sa.DateTime(timezone=True), nullable=True))
op.add_column("agents", sa.Column("payout_threshold", Numeric(10, 2), server_default="10.00"))

# agent_commissions table
op.add_column("agent_commissions", sa.Column("available_at", sa.DateTime(timezone=True), nullable=True))
op.add_column("agent_commissions", sa.Column("payout_batch_id", PGUUID(as_uuid=True), nullable=True))
op.add_index("ix_agent_commissions_available_at", "agent_commissions", ["available_at"])
op.add_index("ix_agent_commissions_status", "agent_commissions", ["status"])
```

### Migration 0035 — Agent payout batches

```python
op.create_table(
    "agent_payout_batches",
    sa.Column("id", PGUUID, primary_key=True, server_default=func.gen_random_uuid()),
    sa.Column("initiated_by", PGUUID, ForeignKey("users.id"), nullable=True),  # null = auto
    sa.Column("total_amount", Numeric(15, 2), nullable=False),
    sa.Column("agent_count", sa.Integer, nullable=False),
    sa.Column("transfer_count", sa.Integer, nullable=False),
    sa.Column("paystack_batch_ref", sa.String(255), nullable=True),
    sa.Column("status", sa.String(30), default="pending"),
    # pending | processing | completed | partial_failed | failed
    sa.Column("results", JSONB, default=dict),  # per-agent outcome
    sa.Column("created_at", sa.DateTime(timezone=True), server_default=func.now()),
    sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
)
```

### Migration 0036 — Loan disbursement transfer tracking

```python
# loan_requests table
op.add_column("loan_requests", sa.Column(
    "disbursement_transfer_code", sa.String(100), nullable=True
))
op.add_index("ix_loan_requests_disbursement_transfer_code", "loan_requests", ["disbursement_transfer_code"])
```

### Migration 0037 — Repayment split linkage

```python
# repayment_instalments table
op.add_column("repayment_instalments", sa.Column("split_code_used", sa.String(100), nullable=True))
op.add_column("repayment_instalments", sa.Column("paystack_ref", sa.String(255), nullable=True))
op.add_index("ix_repayment_instalments_paystack_ref", "repayment_instalments", ["paystack_ref"], unique=True)
```

---

## 6. Service Layer Changes

### 6.1 `AgentNetworkService` additions

```python
async def release_commissions_from_hold(self) -> int:
    """
    Move commissions past their hold period from pending → available.
    Called by Beat every hour. Updates agent.pending_balance and available_balance.
    Returns count of commissions released.
    """

async def get_agent_wallet(self, agent_id: UUID) -> dict:
    """
    Returns { pending_balance, available_balance, total_paid_out,
              last_payout_at, next_payout_date, threshold }
    """

async def prepare_payout_batch(self) -> list[dict]:
    """
    Selects all agents with available_balance >= payout_threshold.
    Returns list of { agent_id, amount, recipient_code, reference }.
    Called by the Beat task before firing bulk transfer.
    """

async def record_payout_batch_result(
    self, batch_id: UUID, results: list[dict]
) -> AgentPayoutBatch:
    """
    Marks commissions as paid/failed based on Paystack bulk transfer response.
    Updates agent.available_balance, total_paid_out, last_payout_at.
    """

async def ensure_recipient_code(self, agent: Agent) -> str:
    """
    Returns agent.paystack_recipient_code if set.
    Otherwise creates Paystack transfer recipient and persists the code.
    Raises ValueError if agent has no momo_phone.
    """
```

### 6.2 `CreditService` / `LoanService` additions

```python
async def initiate_disbursement(self, loan_id: UUID) -> LoanRequest:
    """
    Transitions loan to 'disbursing'. Calls PaystackClient.disburse().
    Stores disbursement_transfer_code. Creates Payment record (type=disbursement).
    Idempotent: no-op if already disbursing/active.
    """

async def confirm_disbursement(self, transfer_code: str) -> LoanRequest:
    """
    Called by webhook handler on transfer.success.
    Finds loan by disbursement_transfer_code.
    Transitions to 'active'. Notifies merchant and lender.
    """

async def fail_disbursement(self, transfer_code: str, reason: str) -> LoanRequest:
    """
    Called by webhook handler on transfer.failed / transfer.reversed.
    Transitions back to 'confirmed'. Notifies admin. Schedules retry task.
    """
```

### 6.3 `LenderService` additions

```python
async def setup_paystack_subaccount(self, lender_id: str) -> LenderPartner:
    """
    Idempotent. Creates Paystack subaccount and split if not already done.
    Steps: create_subaccount() → create_split() → persist codes.
    """

async def initiate_repayment_charge(
    self, instalment_id: UUID, phone: str, provider: str
) -> Payment:
    """
    Builds Paystack charge payload with lender's split_code attached.
    Creates Payment record. Returns payment for status polling.
    """
```

### 6.4 `PaystackClient` additions

```python
async def get_balance(self) -> dict:
    """GET /balance — returns current platform Paystack balance."""

async def verify_recipient(self, recipient_code: str) -> bool:
    """GET /transferrecipient/{code} — validates recipient is active."""

async def list_transfers(
    self, page: int = 1, per_page: int = 50, status: str | None = None
) -> dict:
    """GET /transfer — for reconciliation and admin dashboard."""
```

---

## 7. Webhook Handler Additions

All Paystack webhook events hit a single endpoint (`POST /webhooks/paystack`). The existing handler dispatches by `event` type. Add handlers for:

### `transfer.success`
```
1. Look up Payment by external_ref (transfer code)
2. If type == "disbursement" AND linked to loan:
   → CreditService.confirm_disbursement(transfer_code)
3. If type == "commission_payout":
   → AgentNetworkService.record_payout_batch_result(...)
```

### `transfer.failed` / `transfer.reversed`
```
1. Look up Payment by external_ref
2. If loan disbursement:
   → CreditService.fail_disbursement(transfer_code, reason)
   → Enqueue retry task (with exponential backoff: 15m, 1h, 4h)
3. If commission payout:
   → Mark commission status back to "available"
   → Update AgentPayoutBatch.results with failure
   → Notify admin
```

### `charge.success` (repayment)
```
1. Identify by metadata.payment_type == "loan_repayment"
2. Find RepaymentInstalment by paystack_ref
3. Mark instalment paid
4. Check loan completion → update LoanRequest if all paid
5. Create LenderLoanRevenue record
6. Fire lender webhook (POST to lender_webhook_url)
7. Notify merchant: "Repayment confirmed"
```

### Webhook idempotency
Every webhook handler checks a `webhook_events` table (idempotency key = Paystack event ID) before processing. Duplicate events are silently ignored.

---

## 8. Celery Tasks

### New tasks in `payment_tasks.py`

```python
@celery.task(name="...release_commission_holds")
def release_commission_holds() -> None:
    """Hourly: move commissions past 48h hold from pending → available."""

@celery.task(name="...weekly_agent_payout")
def weekly_agent_payout() -> None:
    """
    Friday 10:00 WAT. Selects all eligible agents, fires Paystack Bulk Transfer,
    creates AgentPayoutBatch record, enqueues webhook reconciliation task.
    """

@celery.task(bind=True, max_retries=3)
def retry_failed_disbursement(self, loan_id: str) -> None:
    """
    Retry a failed loan disbursement. Backoff: 15m → 1h → 4h.
    After max retries, escalate to admin via notification.
    """

@celery.task
def reconcile_payout_batch(batch_id: str) -> None:
    """
    Run 30 minutes after a bulk transfer batch.
    Calls GET /transfer for each transfer_code in the batch.
    Catches any successes/failures missed by webhooks.
    """
```

### Beat schedule additions

```python
"release-commission-holds": {
    "task": "...release_commission_holds",
    "schedule": crontab(minute="0"),  # every hour
},
"weekly-agent-payout": {
    "task": "...weekly_agent_payout",
    "schedule": crontab(minute="0", hour="10", day_of_week="5"),  # Friday 10:00 WAT
},
```

---

## 9. API Endpoints

### Admin endpoints (`/admin/payouts/...`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/payouts/balance` | Platform Paystack balance |
| `GET` | `/admin/payouts/agents/summary` | Total pending/available across all agents |
| `GET` | `/admin/payouts/batches` | List all `AgentPayoutBatch` records |
| `GET` | `/admin/payouts/batches/{id}` | Batch detail with per-agent results |
| `POST` | `/admin/payouts/agents/trigger` | Manually trigger agent payout batch |
| `GET` | `/admin/payouts/loans/pending` | Loans in `confirmed` status awaiting disbursement |
| `POST` | `/admin/payouts/loans/{id}/disburse` | Manually trigger loan disbursement |
| `POST` | `/admin/payouts/loans/{id}/disburse/retry` | Retry failed disbursement |
| `POST` | `/admin/lenders/{id}/setup-subaccount` | Create Paystack subaccount for lender |

### Agent endpoints (`/agent/wallet/...`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/agent/wallet` | Balance summary (pending, available, total earned) |
| `GET` | `/agent/wallet/history` | Payout history (batches + amounts) |
| `GET` | `/agent/wallet/commissions` | Commission list with status and `available_at` |

### Merchant endpoints (additions to `/credit/...`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/credit/loans/{id}/disbursement` | Disbursement status + transfer code |

---

## 10. Frontend Changes

### Admin Portal

**Payout Centre** (new nav item under Ops):
- Platform balance card (live, from Paystack API)
- Agent payout liability card (pending + available balances, total agents)
- "Run Payout Now" button → triggers `/admin/payouts/agents/trigger`
- Payout batch table: date, agent count, total amount, status, Paystack ref
- Batch detail drawer: per-agent outcome (success / failed + reason)

**Loan Operations** (additions to existing loans page):
- "Pending Disbursement" tab: confirmed loans awaiting disbursement
- Disburse button per loan → calls `/admin/payouts/loans/{id}/disburse`
- Disbursement status badge on loan detail: `pending | processing | disbursed | failed`
- Retry button for failed disbursements

**Lender Setup** (additions to lender detail page):
- Paystack subaccount status card
- "Setup Split Account" button → calls `/admin/lenders/{id}/setup-subaccount`
- Settlement bank + account number form

### Agent Portal

**Wallet tab** (new, alongside existing Commissions):
- Balance cards: Pending (with unlock countdown), Available (with next payout date)
- Payout history table: date, amount, reference, status
- Individual commission breakdown with trigger type and `available_at`

---

## 11. Notification Events

| Event | Recipients | Channel |
|---|---|---|
| `commission.available` | Agent | In-app + SMS |
| `payout.sent` | Agent | SMS ("GHc X.XX sent to 024XXXXXXX") |
| `payout.failed` | Agent + Admin | In-app |
| `loan.disbursing` | Merchant | SMS + In-app |
| `loan.disbursed` | Merchant + Lender | SMS + In-app + Lender webhook |
| `loan.disbursement_failed` | Merchant + Admin | In-app + Admin email |
| `repayment.confirmed` | Merchant | SMS + In-app |
| `repayment.lender_notified` | Lender | Lender webhook |

---

## 12. Security & Compliance

### Fraud controls
- **48-hour hold** on commissions — allows reversal if merchant disputes onboarding
- **Minimum threshold** — prevents micro-transfers that erode balance with fees
- **Admin approval gate** (optional, configurable) — batches above GHS 5,000 require 2-admin sign-off
- **Phone number verification** — recipient codes must resolve before payout; invalid phone fails fast at registration, not at payout

### Idempotency
- All Paystack transfer calls use a deterministic `reference` (e.g., `payout-{batch_id}-{agent_id}`)
- All webhook handlers check a `processed_webhook_events` table before acting
- All disbursement calls use `disbursement_payment_ref` from `LoanRequest` as reference

### Audit trail
Every payout action (initiation, completion, failure) creates an `audit_log` entry (already implemented in `core/audit.py`) with:
- `action`: `payout.batch.created`, `payout.commission.paid`, `loan.disbursement.initiated`, etc.
- `actor_id`: admin user or `SYSTEM` for scheduled tasks
- `resource_type` + `resource_id`
- `metadata`: amounts, references, Paystack codes

### Bank of Ghana compliance
- All bulk transfers above GHS 1,000 require Paystack OTP — the system must handle the OTP callback flow. For automated payouts, configure a Paystack "whitelist" or use sub-accounts to avoid OTP friction on known recipients.
- Maintain 90-day payout records (satisfied by `AgentPayoutBatch` + `agent_commissions` tables)

---

## 13. Implementation Phases

### Phase 1 — Foundation (Week 1–2)
- [ ] Migration 0034: Agent wallet balance fields
- [ ] Migration 0035: `AgentPayoutBatch` table
- [ ] `AgentNetworkService.ensure_recipient_code()` — pre-create at registration
- [ ] `AgentNetworkService.release_commissions_from_hold()` + hourly Beat task
- [ ] `AgentNetworkService.get_agent_wallet()` + `/agent/wallet` endpoint
- [ ] Update `_create_commission()` to set `available_at = created_at + 48h`

### Phase 2 — Automated Agent Payouts (Week 2–3)
- [ ] `AgentNetworkService.prepare_payout_batch()` + `record_payout_batch_result()`
- [ ] `weekly_agent_payout` Celery task + Friday Beat schedule
- [ ] Webhook: `transfer.success` and `transfer.failed` for commission payouts
- [ ] `reconcile_payout_batch` task (30-min post-batch safety net)
- [ ] Admin payout centre UI
- [ ] Agent wallet UI

### Phase 3 — Loan Disbursement Hardening (Week 3–4)
- [ ] Migration 0036: `disbursement_transfer_code` on `loan_requests`
- [ ] `CreditService.initiate_disbursement()` with proper idempotency
- [ ] `CreditService.confirm_disbursement()` + `fail_disbursement()`
- [ ] Webhook: `transfer.success/failed` for loan disbursements
- [ ] `retry_failed_disbursement` task with backoff
- [ ] Admin disbursement operations UI
- [ ] Merchant disbursement notifications

### Phase 4 — Lender Revenue Splits (Week 4–5)
- [ ] Migration 0037: `split_code_used` + `paystack_ref` on `repayment_instalments`
- [ ] `LenderService.setup_paystack_subaccount()` — idempotent
- [ ] `LenderService.initiate_repayment_charge()` with split_code
- [ ] Webhook: `charge.success` for repayments → `LenderLoanRevenue` + lender webhook
- [ ] Admin lender subaccount setup UI
- [ ] Lender portal revenue dashboard

### Phase 5 — Hardening & Observability (Week 5–6)
- [ ] Webhook idempotency table + dedup middleware
- [ ] Admin approval gate for large batches
- [ ] `PaystackClient.get_balance()` + platform balance card
- [ ] Full audit log coverage for all payout events
- [ ] Load test: 100-agent bulk transfer batch
- [ ] Runbook: failed disbursement escalation procedure

---

## 14. Testing Checklist

### Unit tests
- Commission hold period logic (commissions not available before 48h)
- Payout threshold filtering (agents below GHS 10 excluded)
- Bulk transfer batch chunking (>100 agents splits into multiple calls)
- Webhook signature verification (reject tampered payloads)
- Idempotent disbursement (same reference → no duplicate transfer)
- Split code used on repayment charges

### Integration tests (Paystack test mode)
- Full agent commission → hold → available → payout cycle
- Loan disbursement → webhook confirm → `LoanRequest.status == "active"`
- Failed disbursement → retry → eventual success
- Repayment charge with split → verify lender subaccount credited
- Bulk transfer > 100 agents → correct batching

### Reconciliation tests
- Missed webhook: `reconcile_payout_batch` catches and finalises transfer
- Stale pending payment: `daily_payment_reconciliation` (existing) catches disbursement

---

## 15. Key Decisions & Rationale

| Decision | Rationale |
|---|---|
| Weekly Friday payout for agents | Aligns with how field agents expect to be paid in Ghana. Reduces per-transfer fees vs daily. |
| 48h commission hold | Fraud buffer. If a merchant reverses a subscription or flags an onboarding, the commission hasn't been paid out yet. |
| Paystack Splits for lenders vs manual transfers | Splits are atomic — lender revenue is separated at charge time. Eliminates the risk of collecting repayment but failing to pay the lender. |
| Minimum payout threshold GHS 10 | Paystack charges per transfer. A GHS 3 commission shouldn't trigger a GHS 1+ transfer fee. Agents accumulate first. |
| Separate `AgentPayoutBatch` table | Full audit trail per batch run. Admin can see exactly what was paid, to whom, and via which Paystack transfer code. Essential for Bank of Ghana record-keeping. |
| Pre-create recipient codes at registration | Avoids failure at payout time due to invalid/unregistered MoMo number. Problems surface when the agent onboards, not on payday. |
