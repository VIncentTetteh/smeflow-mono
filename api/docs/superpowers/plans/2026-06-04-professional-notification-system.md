# Professional Notification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate actionable merchant alerts from consented customer-message delivery history, with truthful delivery states and a focused mobile inbox.

**Architecture:** Add dedicated `MerchantAlert`, `CustomerMessage`, and `DeliveryAttempt` records while retaining legacy `NotificationEvent` for compatibility. New services own alert lifecycle and customer delivery orchestration; mobile consumes new alert and delivery APIs rather than rendering legacy events.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Celery, React Native/Expo, TanStack Query, Pytest, Jest.

---

### Task 1: Notification Domain Schema

**Files:**
- Modify: `apps/api/modules/notifications/models.py`
- Modify: `apps/api/modules/sales/models.py`
- Create: `migrations/versions/0035_professional_notification_system.py`
- Test: `apps/api/tests/integration/test_notifications_professional.py`

- [ ] Write failing tests for merchant alert deduplication fields, customer delivery states, and customer reminder consent.
- [ ] Add merchant-alert, customer-message, delivery-attempt, and consent columns.
- [ ] Add indexes and uniqueness constraints for alert deduplication and message idempotency.
- [ ] Run focused model and migration tests.

### Task 2: Merchant Alert Lifecycle APIs

**Files:**
- Create: `apps/api/modules/notifications/alert_service.py`
- Modify: `apps/api/modules/notifications/schemas.py`
- Modify: `apps/api/modules/notifications/router.py`
- Test: `apps/api/tests/integration/test_notifications_professional.py`

- [ ] Write failing tests for Needs Attention, History, unread count, mark-read, dismiss, deduplication, and automatic resolution.
- [ ] Implement role-aware alert creation and lifecycle operations.
- [ ] Add merchant-safe deep-link action metadata.
- [ ] Verify alerts never expose provider exceptions.

### Task 3: Customer Delivery Orchestration

**Files:**
- Create: `apps/api/modules/notifications/delivery_service.py`
- Modify: `apps/api/workers/tasks/notification_tasks.py`
- Modify: `apps/api/workers/tasks/invoicing_tasks.py`
- Modify: `apps/api/modules/invoicing/router.py`
- Modify: `apps/api/modules/notifications/router.py`
- Test: `apps/api/tests/integration/test_notifications_professional.py`
- Test: `apps/api/tests/unit/test_invoicing.py`

- [ ] Write failing tests for consent enforcement, idempotency, truthful queued/skipped states, sanitized failures, WhatsApp retries, SMS fallback, and final merchant alert creation.
- [ ] Implement customer-message creation and delivery-attempt recording.
- [ ] Route automated credit reminders through consented customer delivery.
- [ ] Make manual invoice sending return truthful state.
- [ ] Add delivery-history and eligible-retry APIs.

### Task 4: Mobile Merchant Inbox

**Files:**
- Modify: `mobile/src/types/notifications.ts`
- Modify: `mobile/src/api/notifications.api.ts`
- Modify: `mobile/src/api/hooks/featureHooks.ts`
- Replace: `mobile/app/owner/notifications.tsx`
- Create: `mobile/app/owner/message-deliveries.tsx`
- Modify: `mobile/app/owner/_layout.tsx`
- Test: `mobile/__tests__/screens/notifications.test.tsx`

- [ ] Write failing tests proving routine delivery events and raw provider errors are absent.
- [ ] Implement Needs Attention and History tabs with read/resolution state.
- [ ] Deep-link primary actions to related records.
- [ ] Replace channel switches and WhatsApp Autopilot with critical/operational policy.
- [ ] Add separate customer delivery-history screen with retry support.

### Task 5: Verification

- [ ] Run focused backend notification and invoicing tests.
- [ ] Run backend Ruff and migration checks.
- [ ] Run focused mobile notification tests.
- [ ] Run mobile TypeScript, lint, and diff checks.
- [ ] Document any legacy compatibility behavior or remaining provider callback work.
