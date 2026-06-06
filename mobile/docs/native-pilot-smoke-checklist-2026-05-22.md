# Native Pilot Smoke Checklist - 2026-05-22

Controlled pilot scope: native Android and iOS dev-client builds only. Expo web is engineering-supported, not a customer pilot surface.

## Build Metadata

| Field | Android | iOS |
| --- | --- | --- |
| Tester |  |  |
| Device / OS |  |  |
| Build profile | pilot | pilot |
| Build artifact / EAS ID |  |  |
| API base URL |  |  |
| Test business |  |  |
| Started at |  |  |
| Completed at |  |  |
| Result | Not run | Not run |

## Evidence Rules

- Capture one screenshot or short video per critical path per platform.
- Record API request IDs, payment/provider references, webhook timestamps, invoice IDs, and sync queue counts where applicable.
- Do not mark provider-backed rows as passed from mocks, simulator-only tests, or local Jest output. Use sandbox/live pilot credentials only.
- Record any failed row in Defects And Rollback with platform, build ID, provider reference, and reproduction steps.

## Critical Path

| Step | Tester steps | Expected result | Required reference/evidence | Android evidence | iOS evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| OTP request | Launch app, enter Ghana test phone, request OTP, tap resend after cooldown. | SMS is received and resend cooldown behaves correctly. | AfricasTalking SMS ID, callback timestamp, screen recording of cooldown. |  |  | Not run |
| OTP verify | Enter valid OTP, then repeat once with an invalid OTP. | Valid OTP reaches onboarding or correct role home; invalid OTP shows actionable error. | Auth verify API request ID, screenshot of destination/error. |  |  | Not run |
| Business onboarding | Create a retail test business with address, TIN/Ghana Card ref when prompted. | Business profile is created and selected as current business. | `POST /api/v1/business` request ID, business ID, selected business screenshot. |  |  | Not run |
| KYC submission | Submit user KYC, then owner business KYC with valid pilot fields. | KYC payload submits, status is visible, and rejected fields are actionable. | User KYC request ID, business KYC request ID, status screenshot. |  |  | Not run |
| MoMo wallet link | Add MTN MoMo wallet, verify if prompted, edit label, set as primary. | Wallet phone is normalized and provider/status copy is clear. | Wallet ID, verify request ID, primary wallet screenshot. |  |  | Not run |
| Add inventory item | Add item with SKU, barcode, cost, sell price, stock, low-stock threshold. | New item appears in inventory and local cache. | Item ID, inventory screenshot, sync queue count. |  |  | Not run |
| Barcode scan | Grant camera permission, scan product barcode in add/search flows. | Permission copy appears and scanned code attaches to item/search. | Video of scan, barcode value, item/search screenshot. |  |  | Not run |
| POS sale - cash | Add item to cart, charge cash, open receipt/invoice handoff. | Sale records once with receipt reference and inventory decrement. | Sale ID, idempotency key, receipt screenshot, inventory count before/after. |  |  | Not run |
| POS sale - MoMo | Add item, enter customer MoMo, send prompt, check payment until final state. | Sale/payment enters pending/success/failure state with retry-safe idempotency key. | Paystack/MTN reference, webhook timestamp, payment ID, mobile state screenshot. |  |  | Not run |
| Offline sale sync | Disable network, record cash sale, reconnect, trigger sync. | Offline sale queues, syncs when online, and does not duplicate. | Offline queue count before/after, sale ID, sync log. |  |  | Not run |
| Invoice from sale | Open sale receipt invoice, send/share PDF, verify invoice list. | Invoice is generated, visible in invoices, and share/send action works. | Invoice ID, PDF/share evidence, send provider callback if SMS/WhatsApp used. |  |  | Not run |
| Push registration | Grant/deny push permission once each where platform allows. | Permission prompt appears and device registration succeeds or fails visibly. | Expo push token or device registration API request ID, screenshot. |  |  | Not run |
| Logout / relogin | Log out, verify scoped data clears, log back in to same business. | Session clears local business-scoped data and relogin restores context. | Logout request ID, local empty-state screenshot, restored dashboard screenshot. |  |  | Not run |

## Repeatable Smoke Runbook

1. Install the Android `pilot` build and iOS `pilot` build on physical devices with camera, SMS, push, and network access.
2. Confirm API base URL, business test data, provider sandbox credentials, and webhook forwarding are configured before starting.
3. Run the Critical Path rows in order on Android, recording every Required reference/evidence value.
4. Repeat the same sequence on iOS using a fresh pilot user or a reset test business.
5. For MoMo, invoice send/share, push, and OTP rows, cross-check provider dashboards against the API/mobile state before marking pass.
6. Attach defects to the Defects And Rollback table and pause the pilot if payment collection, OTP login, offline sync, or logout/relogin fails on either platform.

## Provider/API References To Capture

| Flow | API/provider reference |
| --- | --- |
| OTP | AfricasTalking message ID, delivery callback timestamp, `/api/v1/auth/otp/request` and `/verify` request IDs. |
| Business/KYC | Business ID, user KYC ID/status, business KYC ID/status. |
| MoMo wallet/sale | Wallet ID, Paystack/MTN provider reference, payment ID, webhook timestamp, idempotency key. |
| Offline sync | Local pending count, sync run timestamp, created sale ID, duplicate-check evidence. |
| Invoice send/share | Invoice ID, PDF URL/path, send provider message ID or manual share screenshot. |
| Push | Expo push token, `/api/v1/auth/devices` request ID, visible failure reason if denied. |

## Defects And Rollback

| ID | Severity | Flow | Summary | Owner | Status |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

Rollback path: pause pilot invites, disable payment collection for affected provider, and move impacted businesses to manual support until the defect is closed.
