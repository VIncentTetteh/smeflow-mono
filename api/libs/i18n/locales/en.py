"""English (en) locale strings for SMEFlow USSD and chat interfaces."""

STRINGS: dict[str, str] = {
    # ── USSD ─────────────────────────────────────────────────────────────────
    "ussd.welcome": "CON Welcome to SME Flow",
    "ussd.main_menu": (
        "CON Welcome to SME Flow\n"
        "1. Record Sale\n"
        "2. Check Stock\n"
        "3. Today's Summary\n"
        "4. Send Invoice\n"
        "5. Check Balance\n"
        "6. Credit Score"
    ),
    "ussd.register.enter_name": "CON Welcome to SME Flow\nEnter your business name:",
    "ussd.register.select_type": (
        "CON Select business type\n"
        "1. Market stall\n"
        "2. Shop\n"
        "3. Artisan\n"
        "4. Restaurant\n"
        "5. Service\n"
        "6. Other"
    ),
    "ussd.register.enter_location": "CON Enter your business location or area:",
    "ussd.register.complete": "CON Registration complete!\n",
    "ussd.sale.enter_item": "CON Enter item name or number:",
    "ussd.sale.enter_qty": "CON Enter quantity sold:",
    "ussd.sale.enter_price": "CON Enter unit price (GHS):",
    "ussd.sale.confirm": "CON Confirm sale?\n{qty} x {item} @ GH₵{price}\nTotal: GH₵{total}\n1. Yes\n2. No",
    "ussd.sale.recorded": "END Sale recorded!\n{qty} x {item} = GH₵{total}",
    "ussd.sale.cancelled": "END Sale cancelled.",
    "ussd.stock.enter_item": "CON Enter item name to check stock:",
    "ussd.stock.result": "END {item}: {qty} {unit} in stock",
    "ussd.stock.not_found": "END Item not found. Check the name and try again.",
    "ussd.summary.loading": "END Fetching today's summary...",
    "ussd.summary.result": "END Today's Sales\nRevenue: GH₵{revenue}\nTransactions: {count}\nCash: GH₵{cash}\nMoMo: GH₵{momo}",
    "ussd.receivables.result": "END Outstanding Balances\nTotal owed: GH₵{total}\nDebtors: {count}",
    "ussd.credit.result": "END Credit Score\nScore: {score}/100\nBand: {band}\nMax Loan: GH₵{max_loan}",
    "ussd.credit.none": "END No credit score yet. Keep recording sales to build your score.",
    "ussd.invoice.enter_phone": "CON Enter customer phone (e.g. 0244123456):",
    "ussd.invoice.invalid_phone": "CON Invalid phone. Enter a valid Ghanaian number:",
    "ussd.invoice.enter_amount": "CON Enter invoice amount (GH₵):",
    "ussd.invoice.invalid_amount": "CON Invalid amount. Enter amount in GH₵:",
    "ussd.invoice.created": "END Invoice {number} created.\nTotal: GH₵{total} (incl. VAT).\nSending to {phone} via WhatsApp.",
    "ussd.invoice.failed": "END Invoice creation failed. Please try again or use the app.",
    "ussd.invalid_choice": "CON Invalid choice. Please try again.",
    "ussd.error": "END An error occurred. Please try again later.",
    "ussd.session_timeout": "END Session ended. Dial back to continue.",
    # ── Chat ──────────────────────────────────────────────────────────────────
    "chat.sale_recorded": "Sale recorded! {qty} x {item} @ GH₵{price} = GH₵{total}",
    "chat.sale_needs_info": (
        "I need a bit more info to record the sale. Please tell me the {missing}. "
        "Example: *I sold 3 bags of rice at GH₵ 50*"
    ),
    "chat.stock_level": "{item}: {qty} {unit} in stock",
    "chat.stock_low": "⚠️ {item} is running low - only {qty} {unit} left.",
    "chat.stock_not_found": 'I couldn\'t find "{item}" in your inventory. Check the name and try again.',
    "chat.daily_summary": (
        "Today's summary:\n"
        "Revenue: GH₵{revenue}\n"
        "Sales: {count}\n"
        "Cash: GH₵{cash} | MoMo: GH₵{momo}\n"
        "Credit: GH₵{credit}"
    ),
    "chat.receivables": "Outstanding balances: GH₵{total} from {count} customer(s).",
    "chat.credit_score": "Your credit score is {score}/100 (Band {band}). Max loan: GH₵{max_loan}.",
    "chat.credit_none": "No credit score yet. Keep recording sales to build your score.",
    "chat.help": (
        "Here's what I can do:\n"
        '• *Record a sale* - "I sold 5 tomatoes at 10 cedis"\n'
        '• *Check stock* - "How many bags of rice do I have?"\n'
        '• *Daily report* - "Show me today\'s sales"\n'
        '• *Receivables* - "Who owes me money?"\n'
        '• *Credit score* - "What is my credit score?"\n'
        '• *Language* - "language twi" to switch to Twi'
    ),
    "chat.language_changed": "Language changed to {language}.",
    "chat.unknown": "I didn't understand that. Type *help* to see what I can do.",
    "chat.restock_alert": "Restock alert: You may run out of {items} in {days} day(s) at current sales pace.",
    # ── OTP / Notifications ───────────────────────────────────────────────────
    "otp.message": "Your SMEFlow verification code is {otp}. Valid for 5 minutes.",
    "notification.low_stock": "Low stock alert: {item} has only {qty} {unit} remaining.",
    "notification.payment_received": "Payment received: GH₵{amount} from {phone} for invoice {ref}.",
    "notification.daily_summary": "Daily summary for {date}: Revenue GH₵{revenue}, {count} sales.",
    "notification.tax_reminder": "Reminder: Your {tax_type} return for {period} is due on {due_date}.",
    "notification.payroll_complete": "Payroll complete: {count} staff paid, total GH₵{total}.",
    # ── Errors ────────────────────────────────────────────────────────────────
    "error.generic": "Something went wrong. Please try again.",
    "error.not_found": "{item} not found.",
    "error.unauthorized": "Please log in to continue.",
}
