"""Ewe / Volta-Ho (ew) locale strings for SMEFlow.

Stubs use English values as a baseline. Replace each value with a proper
Ewe translation and remove the # TODO comment when done.
"""

STRINGS: dict[str, str] = {
    # ── USSD ─────────────────────────────────────────────────────────────────
    "ussd.welcome": "CON Welcome to SME Flow",  # TODO: translate to Ewe
    "ussd.main_menu": (
        "CON Welcome to SME Flow\n"
        "1. Record Sale\n"
        "2. Check Stock\n"
        "3. Today's Summary\n"
        "4. Send Invoice\n"
        "5. Check Balance\n"
        "6. Credit Score"
    ),  # TODO: translate to Ewe
    "ussd.register.enter_name": "CON Welcome to SME Flow\nEnter your business name:",  # TODO: translate to Ewe
    "ussd.register.select_type": (
        "CON Select business type\n"
        "1. Market stall\n"
        "2. Shop\n"
        "3. Artisan\n"
        "4. Restaurant\n"
        "5. Service\n"
        "6. Other"
    ),  # TODO: translate to Ewe
    "ussd.register.enter_location": "CON Enter your business location or area:",  # TODO: translate to Ewe
    "ussd.register.complete": "CON Registration complete!\n",  # TODO: translate to Ewe
    "ussd.sale.enter_item": "CON Enter item name or number:",  # TODO: translate to Ewe
    "ussd.sale.enter_qty": "CON Enter quantity sold:",  # TODO: translate to Ewe
    "ussd.sale.enter_price": "CON Enter unit price (GHS):",  # TODO: translate to Ewe
    "ussd.sale.confirm": "CON Confirm sale?\n{qty} x {item} @ GH₵{price}\nTotal: GH₵{total}\n1. Yes\n2. No",  # TODO: translate to Ewe
    "ussd.sale.recorded": "END Sale recorded!\n{qty} x {item} = GH₵{total}",  # TODO: translate to Ewe
    "ussd.sale.cancelled": "END Sale cancelled.",  # TODO: translate to Ewe
    "ussd.stock.enter_item": "CON Enter item name to check stock:",  # TODO: translate to Ewe
    "ussd.stock.result": "END {item}: {qty} {unit} in stock",  # TODO: translate to Ewe
    "ussd.stock.not_found": "END Item not found. Check the name and try again.",  # TODO: translate to Ewe
    "ussd.summary.loading": "END Fetching today's summary...",  # TODO: translate to Ewe
    "ussd.summary.result": "END Today's Sales\nRevenue: GH₵{revenue}\nTransactions: {count}\nCash: GH₵{cash}\nMoMo: GH₵{momo}",  # TODO: translate to Ewe
    "ussd.receivables.result": "END Outstanding Balances\nTotal owed: GH₵{total}\nDebtors: {count}",  # TODO: translate to Ewe
    "ussd.credit.result": "END Credit Score\nScore: {score}/100\nBand: {band}\nMax Loan: GH₵{max_loan}",  # TODO: translate to Ewe
    "ussd.credit.none": "END No credit score yet. Keep recording sales to build your score.",  # TODO: translate to Ewe
    "ussd.invoice.enter_phone": "CON Enter customer phone (e.g. 0244123456):",  # TODO: translate to Ewe
    "ussd.invoice.invalid_phone": "CON Invalid phone. Enter a valid Ghanaian number:",  # TODO: translate to Ewe
    "ussd.invoice.enter_amount": "CON Enter invoice amount (GH₵):",  # TODO: translate to Ewe
    "ussd.invoice.invalid_amount": "CON Invalid amount. Enter amount in GH₵:",  # TODO: translate to Ewe
    "ussd.invoice.created": "END Invoice {number} created.\nTotal: GH₵{total} (incl. VAT).\nSending to {phone} via WhatsApp.",  # TODO: translate to Ewe
    "ussd.invoice.failed": "END Invoice creation failed. Please try again or use the app.",  # TODO: translate to Ewe
    "ussd.invalid_choice": "CON Invalid choice. Please try again.",  # TODO: translate to Ewe
    "ussd.error": "END An error occurred. Please try again later.",  # TODO: translate to Ewe
    "ussd.session_timeout": "END Session ended. Dial back to continue.",  # TODO: translate to Ewe
    # ── Chat ──────────────────────────────────────────────────────────────────
    "chat.sale_recorded": "Sale recorded! {qty} x {item} @ GH₵{price} = GH₵{total}",  # TODO: translate to Ewe
    "chat.sale_needs_info": (
        "I need a bit more info to record the sale. Please tell me the {missing}. "
        "Example: *I sold 3 bags of rice at GH₵ 50*"
    ),  # TODO: translate to Ewe
    "chat.stock_level": "{item}: {qty} {unit} in stock",  # TODO: translate to Ewe
    "chat.stock_low": "⚠️ {item} is running low - only {qty} {unit} left.",  # TODO: translate to Ewe
    "chat.stock_not_found": 'I couldn\'t find "{item}" in your inventory. Check the name and try again.',  # TODO: translate to Ewe
    "chat.daily_summary": (
        "Today's summary:\n"
        "Revenue: GH₵{revenue}\n"
        "Sales: {count}\n"
        "Cash: GH₵{cash} | MoMo: GH₵{momo}\n"
        "Credit: GH₵{credit}"
    ),  # TODO: translate to Ewe
    "chat.receivables": "Outstanding balances: GH₵{total} from {count} customer(s).",  # TODO: translate to Ewe
    "chat.credit_score": "Your credit score is {score}/100 (Band {band}). Max loan: GH₵{max_loan}.",  # TODO: translate to Ewe
    "chat.credit_none": "No credit score yet. Keep recording sales to build your score.",  # TODO: translate to Ewe
    "chat.help": (
        "Here's what I can do:\n"
        '• *Record a sale* - "I sold 5 tomatoes at 10 cedis"\n'
        '• *Check stock* - "How many bags of rice do I have?"\n'
        '• *Daily report* - "Show me today\'s sales"\n'
        '• *Receivables* - "Who owes me money?"\n'
        '• *Credit score* - "What is my credit score?"\n'
        '• *Language* - "language ewe" to switch to Ewe'
    ),  # TODO: translate to Ewe
    "chat.language_changed": "Language changed to {language}.",  # TODO: translate to Ewe
    "chat.unknown": "I didn't understand that. Type *help* to see what I can do.",  # TODO: translate to Ewe
    "chat.restock_alert": "Restock alert: You may run out of {items} in {days} day(s) at current sales pace.",  # TODO: translate to Ewe
    # ── OTP / Notifications ───────────────────────────────────────────────────
    "otp.message": "Your SMEFlow verification code is {otp}. Valid for 5 minutes.",  # TODO: translate to Ewe
    "notification.low_stock": "Low stock alert: {item} has only {qty} {unit} remaining.",  # TODO: translate to Ewe
    "notification.payment_received": "Payment received: GH₵{amount} from {phone} for invoice {ref}.",  # TODO: translate to Ewe
    "notification.daily_summary": "Daily summary for {date}: Revenue GH₵{revenue}, {count} sales.",  # TODO: translate to Ewe
    "notification.tax_reminder": "Reminder: Your {tax_type} return for {period} is due on {due_date}.",  # TODO: translate to Ewe
    "notification.payroll_complete": "Payroll complete: {count} staff paid, total GH₵{total}.",  # TODO: translate to Ewe
    # ── Errors ────────────────────────────────────────────────────────────────
    "error.generic": "Something went wrong. Please try again.",  # TODO: translate to Ewe
    "error.not_found": "{item} not found.",  # TODO: translate to Ewe
    "error.unauthorized": "Please log in to continue.",  # TODO: translate to Ewe
}
