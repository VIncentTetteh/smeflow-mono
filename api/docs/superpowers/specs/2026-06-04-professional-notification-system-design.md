# Professional Notification System Design

**Date:** 2026-06-04
**Status:** Approved product design
**Scope:** Backend notification orchestration and mobile merchant notification experience

## Objective

Replace the current combined notification feed with a professional system that separates:

1. Actionable alerts that require merchant attention.
2. Customer-message delivery attempts and their operational history.

The merchant inbox must stay focused, truthful, role-aware, and actionable. Customer communications must be consented, reliable, auditable, and safe to retry.

## Current Problems

The existing notification flow uses delivery events as merchant inbox entries. This causes several failures:

- Routine events such as every recorded sale flood the inbox.
- Skipped delivery attempts appear alongside actionable failures.
- Raw provider errors and URLs are exposed to merchants.
- A queued background task can be presented as a successfully sent message.
- Customer communications and merchant alerts share channel preferences despite serving different recipients and purposes.
- Repeated failures create noise instead of updating one actionable issue.
- Delivery history does not clearly distinguish queued, attempted, delivered, failed, skipped, or opted-out messages.

## Product Structure

### Merchant Notifications

The Notifications screen is an actionable merchant inbox, not an activity feed.

It has two views:

- **Needs attention:** unresolved actionable alerts.
- **History:** resolved or dismissed alerts.

Only actionable exceptions create merchant alerts:

- Payment failures requiring merchant action.
- Newly overdue credit.
- Sync failures that risk data loss.
- Final customer-message delivery failures after automatic retries and fallback.
- Low-stock alerts.
- KYC decisions.

Routine successes such as recorded sales, generated invoices, and successful message deliveries do not create merchant inbox alerts.

Opening an alert:

- Marks it as read.
- Deep-links to the affected sale, invoice, stock item, customer, or settings page.
- Presents the relevant action, such as **Retry payment**, **Collect payment**, **Restock**, **Retry message**, or **Share manually**.

Repeated occurrences of the same unresolved problem update one evolving alert with its latest status, retry count, and timestamp. They do not create duplicate alerts.

An alert resolves automatically when the underlying problem is fixed. A merchant may dismiss a dismissible alert only after selecting or entering a reason. Resolved and dismissed alerts move to History.

### Customer Message Delivery History

Customer communications use a separate delivery-history surface. It is not part of the merchant inbox.

Delivery history records:

- Recipient and masked destination.
- Message type.
- Related business record.
- Consent source and applicable consent state.
- Requested and actual channels.
- Current delivery status.
- Attempts and timestamps.
- Sanitized failure category.
- Fallback status.

Detailed delivery records are retained for 12 months, then deleted or anonymized according to retention policy.

Raw provider responses, credentials, provider URLs, and stack traces are never shown to merchants. They remain available only to administrators and support through protected operational tooling.

## Recipient And Role Routing

Merchant alerts are routed by role:

- **Owner:** receives all critical and operational alerts for the business.
- **Manager:** receives operational alerts for areas they manage.
- **Cashier:** receives alerts related to transactions they created or own.

All merchant alerts appear in the in-app inbox for eligible recipients.

Immediate push notifications are reserved for financial and operational emergencies:

- Payment failures requiring action.
- Final customer-message delivery failures.
- Sync failures that risk data loss.
- Newly overdue credit.

Low-stock alerts and KYC decisions remain inbox-only by default.

Critical alerts cannot be disabled. Merchants may configure push behavior for non-critical operational alerts.

Merchant SMS and WhatsApp are not default alert channels.

## Customer Consent And Messaging Policy

Automated customer messaging is limited to credit reminders.

Receipts, invoices, and payment links require an explicit merchant action such as **Send** or **Share**.

During the Credit Terms flow, SMEFlow records:

- Consent to automated credit reminders.
- Preferred customer channel.
- Consent timestamp.
- Consent source.
- Customer phone number.
- Opt-out state and timestamp when applicable.

Customers can opt out of WhatsApp and SMS reminders. Legally required notices, if any, are handled separately under the applicable compliance policy. The merchant can see that the customer opted out but cannot override it.

Providing a phone number alone does not constitute consent.

## Credit Reminder Schedule

For consented customers, automated credit reminders are scheduled:

- Three days before the agreed due date.
- On the due date.
- One day overdue.
- Three days overdue.

Reminders stop immediately after:

- Full repayment.
- Credit cancellation or voiding.
- Customer opt-out.
- Invalid or removed customer contact.

Each scheduled reminder uses an idempotency key derived from the receivable, reminder stage, and scheduled date.

## Customer Delivery Workflow

Customer messages follow this state model:

`requested -> queued -> attempting -> delivered`

Alternative terminal or intermediate states are:

- `retry_scheduled`
- `fallback_queued`
- `failed`
- `skipped`
- `opted_out`
- `cancelled`

For consented automated reminders:

1. Attempt WhatsApp first.
2. Retry temporary WhatsApp failures using bounded exponential backoff.
3. Do not retry permanent failures such as invalid numbers, opt-outs, or authentication/configuration errors.
4. After final WhatsApp failure, attempt a shorter SMS containing a secure link.
5. If SMS also fails, create or update one merchant alert with **Retry** and **Share manually** actions.

Provider delivery callbacks are the source of truth for delivered and failed states. A successful provider API request means `queued`, not `delivered`.

Manual invoice sending must return a truthful state:

- **Queued:** accepted for asynchronous delivery.
- **Delivered:** confirmed by provider callback.
- **Failed:** final failure after retries and applicable fallback.
- **Skipped:** no valid contact, no consent where required, or policy prevents sending.

The mobile app must never show “Sent” merely because a background task was queued.

## Failure Classification And Retry Policy

Failures are categorized into stable internal classes:

- `temporary_provider_failure`
- `rate_limited`
- `network_failure`
- `invalid_recipient`
- `recipient_opted_out`
- `provider_authentication_failure`
- `provider_configuration_failure`
- `content_rejected`
- `unknown_failure`

Only temporary, rate-limited, and network failures are retried automatically.

Provider authentication and configuration failures:

- Are not retried per individual message.
- Trigger provider-health monitoring for administrators.
- Surface a sanitized final failure to merchants only when their customer message cannot be delivered.

## Backend Architecture

The backend separates merchant alerts from customer deliveries.

### Merchant Alert

A merchant alert represents one actionable business problem. It includes:

- Business and recipient scope.
- Alert type and severity.
- Related resource type and ID.
- Deduplication key.
- Title and merchant-safe message.
- Deep-link destination and supported actions.
- Read, resolution, and dismissal state.
- First-seen, latest-occurrence, read, resolved, and dismissed timestamps.
- Occurrence and retry counts.

The deduplication key identifies the underlying unresolved issue, for example:

`payment_failure:{payment_id}` or `customer_delivery_final_failure:{message_id}`.

### Customer Message

A customer message represents the business communication being delivered. It includes:

- Business, customer, and related resource references.
- Message type and template version.
- Sanitized template data.
- Consent snapshot.
- Preferred channel.
- Idempotency key.
- Current aggregate delivery state.
- Retention deadline.

### Delivery Attempt

A delivery attempt represents one provider/channel attempt. It includes:

- Customer message reference.
- Channel and provider.
- Attempt number.
- Provider message reference.
- Requested, queued, callback, and completed timestamps.
- Delivery state.
- Sanitized failure class and support-safe detail.
- Fallback relationship.

### Orchestration Services

The notification domain is divided into:

- **Merchant alert service:** creates, deduplicates, routes, deep-links, resolves, and dismisses alerts.
- **Customer message service:** validates policy and consent, creates idempotent messages, and exposes delivery history.
- **Delivery orchestrator:** selects channels, creates attempts, schedules retries, and applies fallback.
- **Provider adapters:** normalize send requests and delivery callbacks for WhatsApp, SMS, and push.
- **Provider health monitor:** detects global authentication, configuration, and availability failures.
- **Retention task:** deletes or anonymizes customer delivery records after 12 months.

## Mobile Experience

### Merchant Notifications Screen

Replace the current global channel switches and combined delivery feed.

The screen contains:

- Unread count for actionable merchant alerts only.
- **Needs attention** and **History** tabs.
- Alert cards with severity, clear business-language description, age, and primary action.
- Deep-link navigation to the affected record.
- Read state separate from resolution state.
- Dismiss action with a required reason where allowed.

The screen must not show:

- Routine recorded-sale events.
- Skipped customer delivery attempts.
- Raw provider errors.
- Customer delivery attempt history.

### Preferences Screen

Replace the current channel-centric and “WhatsApp Autopilot” controls with:

- **Critical alerts:** always enabled; delivery policy explained.
- **Operational alerts:** inbox enabled; configurable push options for low stock and KYC updates.
- **Customer reminders:** consent and delivery policy explanation, not merchant alert channel controls.

SMS fallback applies only to consented customer messages after WhatsApp retries fail.

### Customer Message Delivery History

A separate screen displays customer communications with filters for message type, channel, recipient, and delivery state.

Failed messages expose merchant-safe actions:

- **Retry**
- **Share manually**
- **Open customer**
- **Open invoice or credit record**

## API Behavior

Merchant-alert APIs provide:

- Paginated Needs Attention and History lists.
- Unread count.
- Mark-read operation.
- Dismiss-with-reason operation.
- Alert action metadata.

Customer-message APIs provide:

- Create/send operations that return truthful aggregate delivery state.
- Paginated delivery history.
- Message detail with sanitized attempts.
- Retry operation for eligible final failures.
- Provider callback endpoints protected by signature verification and idempotency.

API responses must never expose raw provider exceptions.

## Observability And Operations

Administrators and support need:

- Delivery success, failure, fallback, and latency metrics by provider and channel.
- Queue depth and oldest queued-message age.
- Provider authentication/configuration health.
- Callback delay and callback validation failures.
- Retry and duplicate-suppression metrics.
- Search by internal message ID, related resource, masked recipient, and provider reference.

Alerts must distinguish an individual recipient failure from a provider-wide incident.

## Migration Strategy

1. Introduce the new merchant-alert, customer-message, and delivery-attempt models alongside the existing notification events.
2. Route new customer communications through the delivery orchestrator.
3. Route new actionable exceptions through the merchant alert service.
4. Update mobile to use the new Merchant Notifications and Delivery History APIs.
5. Stop displaying legacy skipped and routine events in the merchant inbox.
6. Retain legacy events for audit during a defined transition window, then archive or migrate the necessary records.
7. Remove legacy channel switches and “WhatsApp Autopilot” after the new preferences are live.

## Acceptance Criteria

- The merchant inbox contains actionable exceptions only.
- Routine sales and skipped deliveries never appear as merchant alerts.
- No raw provider error is exposed to merchants.
- Opening an alert navigates to the relevant record and action.
- Repeated occurrences update one unresolved alert.
- Fixed issues resolve their alerts automatically.
- Role routing follows owner, manager, and cashier policy.
- Critical alerts generate in-app alerts and immediate push notifications.
- Automated customer messages are limited to consented credit reminders.
- Reminder schedule is exactly three days before, due date, one day overdue, and three days overdue.
- WhatsApp is attempted first and SMS is used only after final eligible WhatsApp failure.
- Send APIs distinguish queued, delivered, failed, skipped, opted-out, and cancelled states.
- Provider callbacks determine final delivery state.
- Delivery attempts are idempotent and safe to retry.
- Detailed customer delivery records are retained for 12 months.

## Testing Strategy

Automated tests cover:

- Alert creation, deduplication, updates, auto-resolution, dismissal, and read state.
- Role-based alert routing.
- Critical push routing and non-critical preference behavior.
- Deep-link action metadata.
- Consent capture, opt-out, and policy enforcement.
- Reminder schedule and immediate stop conditions.
- Idempotent message creation and duplicate suppression.
- Temporary retry, permanent failure, and bounded backoff behavior.
- WhatsApp-to-SMS fallback.
- Provider callback signature validation and idempotency.
- Truthful send-state responses.
- Sanitization of provider errors.
- Delivery-history filtering and pagination.
- Twelve-month retention and anonymization.
- Migration behavior for legacy notification events.

## Explicit Non-Goals

- Sending all merchant alerts through SMS or WhatsApp.
- Automatically sending receipts, invoices, or payment links.
- Showing full customer delivery history inside the merchant inbox.
- Letting merchants disable critical alerts.
- Retrying invalid recipients, opt-outs, or provider authentication failures.
