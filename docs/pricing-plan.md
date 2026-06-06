# SMEflow Pricing Plan

## Overview

SMEflow targets Ghanaian SMEs across three segments:

- **Free** — solo micro-traders testing the platform (market stalls, roadside vendors)
- **Starter** — growing SMEs that need invoicing, AI assistance, and credit access
- **Pro** — established businesses with staff, compliance obligations, and field teams

## Implementation Source of Truth

This pricing strategy is implemented in the backend plan catalogue at `api/apps/api/modules/billing/models.py`, exposed through `/api/v1/billing/plans` and `/api/v1/billing/plan`, and rendered in the mobile billing/onboarding screens under `mobile/app/owner/billing.tsx` and `mobile/app/(auth)/onboarding/plan.tsx`. Keep this document, the backend catalogue, and the mobile display copy in sync when pricing changes.

---

## Pricing Tiers

| | Free | Starter | Pro |
|---|---|---|---|
| **Price** | GH₵0 / month | GH₵49 / month | GH₵149 / month |
| **Billing** | — | Monthly or annual (2 months free) | Monthly or annual (2 months free) |
| **Users** | 1 | 1 owner | 1 owner + up to 5 staff |
| **Field Agents** | — | — | Unlimited |
| **Support** | Community | Email (48h SLA) | Priority (12h SLA) + WhatsApp |

---

## Feature Breakdown

### 📦 Point of Sale & Sales

| Feature | Free | Starter | Pro |
|---|---|---|---|
| POS cart + barcode scan | ✅ | ✅ | ✅ |
| Cash payments | ✅ | ✅ | ✅ |
| MoMo RequestToPay (MTN, Telecel, AT) | ✅ | ✅ | ✅ |
| GhQR payments | ✅ | ✅ | ✅ |
| Sales history | Last 30 days | Last 12 months | Unlimited |
| Receipt sharing (WhatsApp/SMS) | ✅ | ✅ | ✅ |
| Customer records | 50 | 500 | Unlimited |
| Offline-first POS (WatermelonDB sync) | ✅ | ✅ | ✅ |

---

### 🗃️ Inventory Management

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Inventory items | 50 | 500 | Unlimited |
| Item categories | 5 | 25 | Unlimited |
| Low stock alerts | ✅ | ✅ | ✅ |
| Stock adjustments (restock/damage) | ✅ | ✅ | ✅ |
| Stock movement history | 30 days | 12 months | Unlimited |
| Barcode / SKU tracking | ✅ | ✅ | ✅ |
| Cost price + margin tracking | ❌ | ✅ | ✅ |
| Bulk CSV import | ❌ | ❌ | ✅ |

---

### 🤖 Yensem AI Assistant

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Chat in English | ✅ | ✅ | ✅ |
| Chat in Twi | ❌ | ✅ | ✅ |
| Chat in Pidgin | ❌ | ✅ | ✅ |
| Record sales via voice/chat | ✅ (limited) | ✅ | ✅ |
| Inventory queries via chat | ✅ (limited) | ✅ | ✅ |
| Business insights & suggestions | ❌ | ✅ | ✅ |
| AI messages / month | 30 | 300 | Unlimited |

---

### 📊 Analytics & Reporting

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Revenue sparkline (7-day) | ✅ | ✅ | ✅ |
| Cash vs MoMo split | ✅ | ✅ | ✅ |
| Top-selling items | ❌ | ✅ | ✅ |
| Profit & loss summary | ❌ | ✅ | ✅ |
| Cash flow report | ❌ | ❌ | ✅ |
| 12-month revenue trends | ❌ | ✅ | ✅ |
| Export to CSV/PDF | ❌ | ✅ | ✅ |
| Custom date range reports | ❌ | ❌ | ✅ |

---

### 🧾 Invoicing

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Create invoices | ❌ | ✅ | ✅ |
| Invoices per month | — | 20 | Unlimited |
| PDF generation | — | ✅ | ✅ |
| Send via WhatsApp / SMS | — | ✅ | ✅ |
| Recurring invoices | — | ❌ | ✅ |
| Invoice templates / branding | — | Basic | Custom logo + colours |
| Link invoice to sale | — | ✅ | ✅ |
| Void / credit notes | — | ✅ | ✅ |

---

### 👥 Payroll

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Employee records | ❌ | Up to 3 | Unlimited |
| Run payroll | ❌ | ✅ | ✅ |
| Payslip generation | ❌ | ✅ | ✅ |
| SSNIT & PAYE breakdown | ❌ | ✅ | ✅ |
| Bulk MoMo payout | ❌ | ❌ | ✅ |
| Payroll history | — | 6 months | Unlimited |

---

### 🧮 Tax & Compliance

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Tax deadline calendar | ❌ | ✅ | ✅ |
| VAT return drafts | ❌ | ✅ | ✅ |
| GRA submission | ❌ | ❌ | ✅ |
| Input VAT tracking | ❌ | ❌ | ✅ |
| Tax export (CSV/PDF) | ❌ | ✅ | ✅ |

---

### 💳 Credit & Loans

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Credit score (view only) | ❌ | ✅ | ✅ |
| Credit score factors breakdown | ❌ | ✅ | ✅ |
| Pre-approved loan offers | ❌ | ✅ | ✅ |
| Loan application | ❌ | ✅ | ✅ |
| Repayment schedule | ❌ | ✅ | ✅ |
| MoMo disbursement | ❌ | ✅ | ✅ |

> Credit scoring is powered by in-app sales, inventory, and repayment data. Starter/Pro users with consistent sales history unlock better offers.

---

### 🏢 Field Agent Tools

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Field agent accounts | ❌ | ❌ | Unlimited |
| KYC pipeline management | ❌ | ❌ | ✅ |
| Trader onboarding (single) | ❌ | ❌ | ✅ |
| Bulk CSV trader onboard | ❌ | ❌ | ✅ |
| Commission tracking | ❌ | ❌ | ✅ |
| Commission payout (MoMo) | ❌ | ❌ | ✅ |
| Agent performance dashboard | ❌ | ❌ | ✅ |
| Bonus milestone tracking | ❌ | ❌ | ✅ |

---

### 🏬 Multiple Businesses

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Businesses per account | 1 | 1 | 3 |
| Additional businesses (add-on) | ❌ | ❌ | +GH₵49 / extra business / month |
| Switch active business in-app | — | — | ✅ |
| Separate inventory per business | — | — | ✅ |
| Separate sales & analytics per business | — | — | ✅ |
| Separate payroll & tax per business | — | — | ✅ |
| Unified dashboard across businesses | — | — | ✅ (coming soon) |

> Business switching is handled via `active_business_id` in the auth store. Each business has fully isolated books — inventory, sales, payroll, tax, and credit scoring are scoped per `business_id`.

---

### ⚙️ Platform & Security

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Phone OTP login | ✅ | ✅ | ✅ |
| Biometric unlock | ✅ | ✅ | ✅ |
| Ghana Card KYC verification | ✅ | ✅ | ✅ |
| Offline-first sync | ✅ | ✅ | ✅ |
| Push notifications | ✅ | ✅ | ✅ |
| Dark mode | ✅ | ✅ | ✅ |
| Multi-language (EN/Twi/Pidgin) | EN only | ✅ | ✅ |
| API access | ❌ | ❌ | ✅ (coming soon) |
| Data export (full account) | ❌ | ✅ | ✅ |

---

## Upgrade Triggers (Conversion Strategy)

These are the moments in the app where users hit a Free limit and see an upgrade prompt:

| Trigger | Shown on |
|---|---|
| 40th inventory item added | Free |
| 25th customer saved | Free |
| First invoice attempt | Free |
| First credit score tap | Free |
| Chat message 28/30 in a month | Free |
| First employee record attempt | Free & Starter (>3) |
| GRA submission attempt | Starter |
| First field agent invite | Free & Starter |
| Second business creation attempt | Free & Starter |
| 4th business creation attempt | Pro (upsell add-on) |

---

## Recommended Pricing Rationale

- **GH₵49 Starter** sits at ~$3 USD — affordable for a trader with GH₵2,000+/month revenue; less than a mobile data bundle.
- **GH₵149 Pro** targets businesses with payroll (~$10 USD) — positioned as cheaper than an accountant for a single visit.
- **Annual billing** (2 months free) incentivises lock-in and reduces churn: GH₵490/yr (Starter), GH₵1,490/yr (Pro).
- **Free tier is generous on POS/inventory** — the core daily-use loop — so users build habit before hitting limits on higher-value features (invoicing, credit, payroll).

---

## Plan Limits Summary

| Limit | Free | Starter | Pro |
|---|---|---|---|
| Inventory items | 50 | 500 | ∞ |
| Customers | 50 | 500 | ∞ |
| Invoices / month | 0 | 20 | ∞ |
| Employees | 0 | 3 | ∞ |
| AI messages / month | 30 | 300 | ∞ |
| Sales history | 30 days | 12 months | ∞ |
| Languages | English | EN + Twi + Pidgin | EN + Twi + Pidgin |
| Users | 1 | 1 | 6+ |
| Field agents | 0 | 0 | ∞ |
| Businesses | 1 | 1 | 3 (+ add-on) |
