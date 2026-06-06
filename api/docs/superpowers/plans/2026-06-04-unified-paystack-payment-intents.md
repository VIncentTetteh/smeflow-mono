# Unified Paystack Payment Intents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let merchants accept any Paystack-supported customer payment channel without leaving SMEflow, while recording the actual channel for analytics.

**Architecture:** Generalize the existing reserved-stock MoMo sale intent into a Paystack payment intent initialized through Paystack Checkout. The merchant remains on a waiting screen that shows a customer-scannable QR and shareable link. Paystack verification/webhooks persist the actual channel and finalize the sale. Existing MoMo endpoints remain compatibility aliases.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Paystack Transactions API, React Native/Expo, Jest, Pytest.

---

### Task 1: Persist Paystack Channel Details

**Files:**
- Modify: `apps/api/modules/payments/models.py`
- Create: `migrations/versions/0033_payment_channel_analytics.py`
- Test: `apps/api/tests/integration/test_payments.py`

- [ ] Add `processor`, `channel`, and `provider_detail` fields to payments.
- [ ] Migrate existing collection rows to a sensible processor/channel.
- [ ] Verify model and migration lint.

### Task 2: Generalize Paystack Sale Intents

**Files:**
- Modify: `libs/payment_clients/paystack.py`
- Modify: `apps/api/modules/sales/schemas.py`
- Modify: `apps/api/modules/sales/router.py`
- Modify: `apps/api/modules/sales/service.py`
- Test: `apps/api/tests/integration/test_sales.py`

- [ ] Add transaction verification that returns channel metadata.
- [ ] Add `/sales/payment-intents` create/get/verify endpoints.
- [ ] Initialize Paystack Checkout and return the customer payment URL.
- [ ] Keep `/sales/momo/intents` as compatibility aliases.
- [ ] Finalize successful Paystack intents as `payment_method=paystack`.

### Task 3: Track Webhook Channel and Analytics

**Files:**
- Modify: `apps/api/modules/payments/router.py`
- Test: `apps/api/tests/integration/test_payments.py`

- [ ] Persist `data.channel` and authorization provider detail on Paystack events.
- [ ] Add `/payments/analytics/channels` grouped successful collection totals.
- [ ] Verify card, mobile money, and GhQR/cash reporting behavior.

### Task 4: Customer-Facing Mobile Paystack Flow

**Files:**
- Modify: `mobile/src/types/sales.ts`
- Modify: `mobile/src/api/sales.api.ts`
- Modify: `mobile/src/features/localData.ts`
- Modify: `mobile/src/features/sellCart.ts`
- Modify: `mobile/src/features/onlineSales.ts`
- Modify: `mobile/app/owner/sell.tsx`
- Test: `mobile/__tests__/features/onlineSales.test.ts`
- Test: `mobile/__tests__/screens/sellScreen.test.tsx`

- [ ] Add `paystack` sale method and generic payment intent types.
- [ ] Show Paystack as the primary digital payment option.
- [ ] Display customer payment QR/link and keep merchant on waiting screen.
- [ ] Retain direct MoMo prompt as a secondary Paystack shortcut.
- [ ] Poll verification and complete the sale after payment.

### Task 5: Verification

- [ ] Run focused backend payment/sales tests.
- [ ] Run focused mobile payment/sell tests.
- [ ] Run Ruff, TypeScript, and diff checks.
