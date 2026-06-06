# Provider Smoke Checklist - 2026-05-22

Record sandbox references, callback timestamps, expected statuses, and rollback notes for every enabled pilot provider before customer use.

## Credential Prerequisites

| Provider | Required before testing | Owner | Confirmed |
| --- | --- | --- | --- |
| MTN MoMo / Paystack collections | Paystack secret/public keys, MTN mobile-money channel enabled, webhook URL, webhook secret, Ghana test phone. | Payments owner | No |
| AfricasTalking | Username/API key, sender/channel config, Ghana test phone, callback URL/secret. | Messaging owner | No |
| Hubtel | Client ID/secret or merchant credentials, callback URL, enabled feature flag, test phone/account. | Messaging owner | No |
| USSD | Short code or simulator credentials, callback URL, `USSD_CALLBACK_SECRET`, Redis/session config. | Platform owner | No |

## MTN MoMo

| Check | Tester action | Pass criteria | Reference / timestamp | Status |
| --- | --- | --- | --- | --- |
| Collection request | Start a mobile POS MoMo sale from pilot build using MTN test number. | Mobile shows pending, provider returns a trackable reference, API stores payment ID/idempotency key. |  | Not run |
| Check payment / retry | Tap Check payment now before and after customer approval. | Pending stays pending without duplicate sale; success records one sale and receipt. |  | Not run |
| Webhook signature | Replay one invalid and one valid webhook payload. | Invalid signature is rejected; valid signature updates payment state. |  | Not run |
| Webhook source IP | Send callback from non-allowlisted IP when allowlist is configured. | Non-allowlisted IP is rejected and logged. |  | Not run |
| Duplicate webhook | Replay the same valid provider reference twice. | Same provider reference is idempotent; no duplicate sale/inventory decrement. |  | Not run |
| Disbursement sandbox | Trigger payroll/disbursement path only if enabled for pilot. | Disbursement status is recorded or unsupported state is shown clearly. |  | Not run |

## Paystack

| Check | Tester action | Pass criteria | Reference / timestamp | Status |
| --- | --- | --- | --- | --- |
| Mobile money transaction | Start POS MoMo payment or billing checkout through pilot build. | Provider returns a trackable reference and mobile reaches expected pending/success/failure state. |  | Not run |
| Webhook HMAC | Replay invalid and valid Paystack webhooks. | Invalid HMAC is rejected; valid HMAC updates payment/subscription. |  | Not run |
| Billing subscription | Subscribe to paid plan, verify checkout, change back to free where supported. | Business tier/status updates after webhook/verify and billing workspace refreshes. |  | Not run |
| Duplicate webhook | Replay the same Paystack reference twice. | Same reference is idempotent. |  | Not run |
| Checkout close/reopen | Close checkout, reopen billing, verify payment manually if available. | Mobile shows recoverable state and does not mark paid without provider confirmation. |  | Not run |

## AfricasTalking

| Check | Tester action | Pass criteria | Reference / timestamp | Status |
| --- | --- | --- | --- | --- |
| OTP SMS delivery | Request OTP from Android and iOS pilot builds. | SMS sends to Ghana test phone and callback is received. |  | Not run |
| Delivery callback auth | Replay callback with invalid username/secret. | Callback validation rejects invalid source. |  | Not run |
| Failure state | Force invalid phone/provider error where sandbox allows. | Failed delivery is visible in logs/support workflow and mobile copy is actionable. |  | Not run |
| Invoice/alert SMS | Send invoice or low-stock SMS only if endpoint/channel is enabled. | Provider message ID is stored and mobile/API exposes success/failure status. |  | Not run |

## Hubtel

| Check | Tester action | Pass criteria | Reference / timestamp | Status |
| --- | --- | --- | --- | --- |
| Verification request | Trigger Hubtel-backed flow only when pilot credentials are configured. | Provider returns trackable reference/status. |  | Not run |
| Callback validation | Replay invalid and valid callback payloads. | Signature/source validation is confirmed. |  | Not run |
| Disabled-provider behavior | Run mobile/API path with Hubtel disabled. | App/API shows manual-support fallback and does not silently fail. |  | Not run |
| Low-stock WhatsApp/SMS | Send a low-stock alert only if the backend channel contract is enabled. | Eligible item, recipient phone, channel, provider status, and retry/error are visible. |  | Not run |

## USSD

Pilot inclusion: optional. Complete only if USSD is included for named pilot businesses.

| Check | Tester action | Pass criteria | Reference / timestamp | Status |
| --- | --- | --- | --- | --- |
| Menu session | Start callback from telco simulator/test short code and complete registration/sale/stock path. | Callback starts and advances through expected menu states. |  | Not run |
| Signature/source validation | Send invalid callback signature/secret. | Invalid callback is rejected. |  | Not run |
| Timeout/retry | Let one session time out, then retry. | User receives clear retry or support path. |  | Not run |
| Mobile reconciliation | Compare USSD-created sale/stock update with mobile dashboard after sync/refresh. | Mobile reflects backend state without duplicate local writes. |  | Not run |

## Low-Stock Alert Contract

Minimum mobile/API contract before marking WhatsApp/SMS low-stock alerts pilot-ready:

| Field | Required behavior |
| --- | --- |
| Eligible item | Item has `id`, `name`, `stock_qty`, `low_stock_threshold`, and current stock at or below threshold after a sale/adjustment. |
| Threshold crossing | Backend distinguishes already-low items from newly crossed threshold events, or returns enough timestamp/event data for mobile/support to avoid duplicate sends. |
| Channel preference | Business/user notification preferences identify WhatsApp, SMS, push, or disabled channel. |
| Recipient phone | API returns normalized recipient phone and role/source, with clear validation error if missing. |
| Provider status | Alert result includes provider, provider reference, status, sent/failed timestamp, and message/error copy. |
| Retry/error display | Mobile can show pending/failed/sent and retry only failed/retryable alerts without creating duplicates. |

Current contract note: `/api/v1/inventory/restock-alerts`, `/api/v1/analytics/inventory/alerts/low-stock`, and `/api/v1/analytics/inventory/low-stock` expose alert candidates, but the mobile-facing WhatsApp/SMS send/status/retry response is not confirmed here. Keep automated tests local/API-only until provider credentials and this response shape are available.

## Rollback Notes

| Provider | Disable switch / config | Support message | Owner |
| --- | --- | --- | --- |
| MTN MoMo |  |  |  |
| Paystack |  |  |  |
| AfricasTalking |  |  |  |
| Hubtel |  |  |  |
| USSD |  |  |  |
