**SME Flow – Comprehensive User Stories**

Here is a complete set of **user stories** organized by major modules/entities. They follow the standard format:  
**As a [role], I want [feature] so that [benefit].**  
Acceptance criteria (AC) are included for key stories to guide implementation, testing, and compliance.

### 1. User, Business & Onboarding

- **As a new SME owner**, I want to register using my Ghana phone number and OTP so that I can create an account quickly without email.
- **As a new user**, I want to create/link my business profile (name, type e.g. market stall/shop, location, TIN/Ghana Card) so that the system knows my business context.
- **As a business owner**, I want to link my MoMo/Vodafone Cash/AirtelTigo wallet(s) so that payments can be collected and disbursed seamlessly.
- **As a business owner**, I want to invite employees/staff by phone number with role-based permissions so that they can help record sales without full access.
- **As an agent (field onboarding)**, I want to onboard multiple traders via a special agent flow so that I can help non-tech-savvy users get started.
- **As a user**, I want USSD fallback (*SMEFLOW# or short code) for basic registration and actions so that I can use the system on feature phones.
- **As a user**, I want to complete basic KYC/verification so that I can unlock lending and full tax features.

**AC**: Phone primary key, business multi-tenancy, data scoped by `business_id`.

### 2. Inventory & Stock Management

- **As a business owner**, I want to add/edit inventory items (name, unit e.g. kg/pieces, cost price, selling price, category, low-stock threshold) so that I can track what I have.
- **As a staff member**, I want to record stock purchases or adjustments (damages, returns) so that stock levels stay accurate.
- **As a business owner**, I want low-stock alerts via WhatsApp/SMS so that I never run out of popular items.
- **As a user**, I want to view current stock levels and search items quickly (chat or app) so that I can make fast sales decisions.
- **As a business owner**, I want to support simple barcode/QR scanning for items (future) so that checkout is faster.

**AC**: Atomic stock updates on sales/purchases; history of all adjustments for audit.

### 3. Sales & Transactions

- **As a staff/owner**, I want to record a sale via chat (“sold 5 tomatoes 25 cedis”) or form so that inventory deducts automatically and revenue is tracked.
- **As a seller**, I want to handle mixed payments (cash + MoMo) and partial/credit sales so that I can serve customers flexibly.
- **As a business owner**, I want daily sales summaries automatically sent via WhatsApp so that I know how the day went without manual calculation.
- **As a user**, I want to record credit sales and track receivables so that I can follow up on owed money.
- **As a user**, I want offline sale recording with automatic sync when online so that I can sell even without internet in the market.

**AC**: Idempotent transactions; full audit trail; real-time or eventual inventory consistency.

### 4. Invoicing & Receipts (GRA Compliant)

- **As a seller**, I want the system to auto-generate a compliant invoice/receipt on every sale so that it includes all GRA-required fields (TIN, items, VAT/levies, totals, timestamp).
- **As a seller**, I want a GhQR code (static or dynamic) on every receipt so that customers can pay instantly via any mobile money.
- **As a business owner**, I want to generate standalone invoices for credit or bulk customers so that I can send them via WhatsApp.
- **As a user**, I want to issue credit/debit notes linked to original invoices so that corrections are properly tracked for tax.
- **As a seller**, I want to share receipts as image/PDF via WhatsApp so that customers have proof.

**AC**: Every invoice must contain QR code, digital signature/encrypted data per GRA e-VAT guidelines; immutable once issued.

### 5. Payments & Mobile Money

- **As a seller**, I want to request payment via MoMo (RequestToPay) directly from a sale so that the customer gets a prompt on their phone.
- **As a business owner**, I want automatic reconciliation of incoming mobile money payments to specific invoices/sales so that my books stay accurate.
- **As a user**, I want to generate a dynamic GhQR for a specific amount or static business QR so that customers can scan and pay easily.
- **As a business owner**, I want to make disbursements (supplier payments, refunds) via mobile money so that I can operate cashlessly.
- **As the system**, I want secure webhooks from payment providers with retry logic and reconciliation so that no transactions are lost.

### 6. Payroll & Employees

- **As a business owner**, I want to add employees with salary/wage details and phone numbers so that I can manage my team digitally.
- **As an owner**, I want to record attendance or daily wages so that payroll is accurate for casual staff.
- **As an owner**, I want to run payroll and generate payslips so that I can pay staff via mobile money in one go.
- **As an employee**, I want to receive payslip via WhatsApp so that I have proof of payment.

**AC**: Tax/NHIL deductions if applicable; audit of all payroll runs.

### 7. Tax Compliance & GRA Filing

- **As a business owner**, I want the system to automatically calculate and summarize VAT, income tax estimates, and levies from all transactions so that filing is easy.
- **As a user**, I want monthly tax summary reports and filing-ready exports so that I can submit to GRA on time.
- **As a user**, I want reminders for GRA filing deadlines so that I avoid penalties.
- **As a user (premium)**, I want one-click or assisted filing to GRA portal (via generated file or future API) so that compliance is effortless.

**AC**: Full transaction history retained for audits; GRA e-VAT structured data support.

### 8. Credit Scoring & Embedded Lending

- **As a business owner**, I want an instant credit score based on my transaction history, sales consistency, and repayment behavior so that I know my eligibility.
- **As a qualified user**, I want to see personalized micro-credit offers (“You qualify for GHS 8,000”) with terms so that I can grow my business.
- **As a user**, I want to apply for embedded loans directly in the app/chat so that funds are disbursed quickly to my MoMo.
- **As a lender partner**, I want access to anonymized/approved credit profiles via API so that I can underwrite loans safely.
- **As the system**, I want to track loan repayment performance to improve future scoring.

**AC**: Rule-based + simple ML scoring; clear consent for data sharing; risk flags for high-risk requests.

### 9. Analytics & Reporting

- **As a business owner (free)**, I want basic daily/weekly sales, top products, and cash flow summary so that I understand my business.
- **As a premium user**, I want advanced reports (profit/loss, trends, stock turnover, customer insights) with exports so that I can make better decisions.
- **As an owner**, I want visual charts and predictive alerts (e.g., “Restock tomatoes soon”) so that I can plan ahead.

### 10. Chat & USSD Interface

- **As a user**, I want to perform most actions via simple WhatsApp-style chat (“add item rice…”, “sell 10 eggs 20”, “stock check”, “daily report”) so that I don’t need complex menus.
- **As a user**, I want the system to understand context and respond conversationally (e.g., confirm sale details) so that it’s natural like talking to an assistant.
- **As a feature phone user**, I want full menu-driven USSD access for key features (sales, stock, reports) so that I am not excluded.
- **As a user**, I want multi-language support (English + Twi etc.) in chat responses.

**AC**: Command parser with fallback to structured menus; session management.

### 11. Notifications & Communication

- **As a user**, I want automated WhatsApp/SMS notifications for low stock, payment confirmations, daily summaries, tax reminders, and credit offers.
- **As an owner**, I want to send bulk messages to customers or staff via the platform.

### 12. Subscriptions, Billing & Premium Features

- **As a user**, I want a clear freemium model so that core features are free and I only pay for premium (analytics, higher limits, priority support, advanced lending).
- **As a user**, I want to subscribe/pay for premium via mobile money so that upgrading is seamless.
- **As the system**, I want to enforce usage limits and gracefully prompt for upgrade.

### 13. Admin, Agent & Platform Management

- **As platform admin**, I want to monitor overall usage, transactions, and revenue so that I can run the business.
- **As an agent**, I want a dashboard to track onboarded users and commissions so that I am incentivized to grow the network.
- **As admin**, I want audit logs and fraud review tools for all financial actions.

### 14. Cross-Cutting / Non-Functional

- **As any user**, I want my data secure with proper Ghana data protection compliance and end-to-end encryption for sensitive info.
- **As any user**, I want reliable offline support with automatic sync so that market connectivity issues don’t stop my work.
- **As a user**, I want viral referral: “Invite 3 friends, get 1 month premium” so that the platform grows organically.
- **As all users**, I want fast performance even on low-end devices and slow networks.

These user stories cover **end-to-end** functionality from onboarding through daily operations, compliance, financing, and growth. They map directly to the entities (Business, Item, Sale, Invoice, Employee, Payment, TaxSummary, CreditScore, etc.) and support the ambitious Year-1 targets.