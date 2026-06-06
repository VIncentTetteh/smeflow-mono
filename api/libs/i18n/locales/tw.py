"""Twi (tw) locale strings for SMEFlow USSD and chat interfaces."""

STRINGS: dict[str, str] = {
    # ── USSD ─────────────────────────────────────────────────────────────────
    "ussd.welcome": "CON Akwaaba SME Flow",
    "ussd.main_menu": (
        "CON Akwaaba SME Flow\n"
        "1. Fa Ntoatoa\n"
        "2. Hwɛ Nneɛma\n"
        "3. Nnɛ Nhyehyɛe\n"
        "4. Soma Invoice\n"
        "5. Hwɛ Sika a Wɔhwɛ\n"
        "6. Credit Score"
    ),
    "ussd.register.enter_name": "CON Akwaaba SME Flow\nDa wo adwuma din ase:",
    "ussd.register.select_type": (
        "CON Paw adwuma suban\n"
        "1. Aguabea\n"
        "2. Sotɔ\n"
        "3. Ɔdwumayɛni\n"
        "4. Aduane Sotɔ\n"
        "5. Sohwɛ\n"
        "6. Ebi foforɔ"
    ),
    "ussd.register.enter_location": "CON Da wo adwumayɛbea ase:",
    "ussd.register.complete": "CON Wɔahyehyɛ wo ade!\n",
    "ussd.sale.enter_item": "CON Da nneɛma din ase anaa nɔmba:",
    "ussd.sale.enter_qty": "CON Da dodow a wotɔn ase:",
    "ussd.sale.enter_price": "CON Da ɛboɔ bi (GHS) ase:",
    "ussd.sale.confirm": "CON Sɔ ntoatoa?\n{qty} x {item} @ GH₵{price}\nNkakramu: GH₵{total}\n1. Aane\n2. Daabi",
    "ussd.sale.recorded": "END Wɔakyerɛw ntoatoa!\n{qty} x {item} = GH₵{total}",
    "ussd.sale.cancelled": "END Wɔamua ntoatoa.",
    "ussd.stock.enter_item": "CON Da nneɛma din ase na ehwɛ stock:",
    "ussd.stock.result": "END {item}: {qty} {unit} wɔ stock mu",
    "ussd.stock.not_found": "END Ɛanhuu nneɛma no. Hwɛ din no na yɛ bio.",
    "ussd.summary.loading": "END Refa nnɛ nhyehyɛe...",
    "ussd.summary.result": "END Nnɛ Ntoatoa\nSika: GH₵{revenue}\nNtoatoa: {count}\nSika Tɔɔ: GH₵{cash}\nMoMo: GH₵{momo}",
    "ussd.receivables.result": "END Sika a Wɔhwɛ\nNkakramu: GH₵{total}\nAhofoa: {count}",
    "ussd.credit.result": "END Credit Score\nScore: {score}/100\nBand: {band}\nOwɔ: GH₵{max_loan}",
    "ussd.credit.none": "END Wo credit score nni hɔ. Kyerɛw ntoatoa pii na wo score bɛba.",
    "ussd.invoice.enter_phone": "CON Da ahofoa foon nɔmba ase (nhwɛso 0244123456):",
    "ussd.invoice.invalid_phone": "CON Foon nɔmba no ntua. Da Ghana nɔmba pa ase:",
    "ussd.invoice.enter_amount": "CON Da invoice bɔɔ ase (GH₵):",
    "ussd.invoice.invalid_amount": "CON Bɔɔ no ntua. Da bɔɔ GH₵ mu ase:",
    "ussd.invoice.created": "END Invoice {number} wɔ hɔ.\nNkakramu: GH₵{total} (VAT mu).\nResoma {phone} WhatsApp mu.",
    "ussd.invoice.failed": "END Invoice no nyɛ. Yɛ bio anaa fa app no.",
    "ussd.invalid_choice": "CON Ɛntua. Yɛ bio.",
    "ussd.error": "END Biribi ayɛ bɔne. Yɛ bio akyire.",
    "ussd.session_timeout": "END Ɔkwan no ato mu. Fɛre bio.",
    # ── Chat ──────────────────────────────────────────────────────────────────
    "chat.sale_recorded": "Wɔakyerɛw ntoatoa! {qty} x {item} @ GH₵{price} = GH₵{total}",
    "chat.sale_needs_info": (
        "Mehia nsɛm pii bio na makyerɛw ntoatoa. Kyerɛ me {missing}. "
        "Nhwɛso: *Metɔn bag atom 3 GH₵ 50 ho*"
    ),
    "chat.stock_level": "{item}: {qty} {unit} wɔ stock mu",
    "chat.stock_low": "⚠️ {item} reyɛ ketewa — {qty} {unit} na aka.",
    "chat.stock_not_found": 'Merenhunu "{item}" wo nneɛma mu. Hwɛ din no na yɛ bio.',
    "chat.daily_summary": (
        "Nnɛ nhyehyɛe:\n"
        "Sika: GH₵{revenue}\n"
        "Ntoatoa: {count}\n"
        "Sika Tɔɔ: GH₵{cash} | MoMo: GH₵{momo}\n"
        "Credit: GH₵{credit}"
    ),
    "chat.receivables": "Sika a wɔhwɛ: GH₵{total} afi ahofoa {count}.",
    "chat.credit_score": "Wo credit score yɛ {score}/100 (Band {band}). Owɔ: GH₵{max_loan}.",
    "chat.credit_none": "Wo credit score nni hɔ. Kyerɛw ntoatoa pii na wo score bɛba.",
    "chat.help": (
        "Ɛnyɛ a metumi ayɛ:\n"
        '• *Kyerɛw ntoatoa* — "Metɔn tomato 5 sidi 10 ho"\n'
        '• *Hwɛ stock* — "Atom bags dodow sɛn na mewɔ?"\n'
        '• *Nnɛ nhyehyɛe* — "Kyerɛ me nnɛ ntoatoa"\n'
        '• *Sika a wɔhwɛ* — "Hena na ɔhwɛ me sika?"\n'
        '• *Credit score* — "Me credit score yɛ sɛn?"\n'
        '• *Kasa* — "language english" na san kɔ English'
    ),
    "chat.language_changed": "Wɔasesa kasa kɔ {language}.",
    "chat.unknown": "Mente aseɛ. Twerɛ *help* na mahu dɛ metumi ayɛ.",
    "chat.restock_alert": "Restock kɔkɔ: Wobɛtumi awie {items} da {days} mu sɛ wotɔn te saa.",
    # ── OTP / Notifications ───────────────────────────────────────────────────
    "otp.message": "Wo SMEFlow nsɛnkyerɛne kode yɛ {otp}. Ɛtɔ mu dɛ sima 5.",
    "notification.low_stock": "Stock hia: {item} wɔ {qty} {unit} na aka.",
    "notification.payment_received": "Wɔagyaa sika: GH₵{amount} afi {phone} fa invoice {ref}.",
    "notification.daily_summary": "{date} nhyehyɛe: Sika GH₵{revenue}, ntoatoa {count}.",
    "notification.tax_reminder": "Kae: Wo {tax_type} a ɛfa {period} ho yɛ due {due_date}.",
    "notification.payroll_complete": "Wɔatua anigyeɛ: staff {count} katua, nkakramu GH₵{total}.",
    # ── Errors ────────────────────────────────────────────────────────────────
    "error.generic": "Biribi ayɛ bɔne. Yɛ bio.",
    "error.not_found": "Wɔanhunu {item}.",
    "error.unauthorized": "Bɔ login na bɛba bio.",
}
