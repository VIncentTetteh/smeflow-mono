"""
Expense categories — an authoritative constant, not a table.

Categories are fixed rather than user-defined so that a merchant cannot invent a
category that silently corrupts net profit. The `kind` on each entry is what
keeps the P&L honest:

  operating      → subtracted from gross profit to give net profit
  cogs           → already counted via SaleItem.cost_price; must NOT be counted again
  non_operating  → money leaving the business that is not a cost of trading
                   (owner drawings, loan principal)

Only `operating` categories feed `operating_expenses` in AnalyticsService.pnl_summary.
"""

KIND_OPERATING = "operating"
KIND_COGS = "cogs"
KIND_NON_OPERATING = "non_operating"

EXPENSE_CATEGORIES: list[dict[str, str]] = [
    {"key": "rent", "label": "Rent", "kind": KIND_OPERATING},
    {"key": "transport_fuel", "label": "Transport & fuel", "kind": KIND_OPERATING},
    {"key": "utilities", "label": "Utilities (light & water)", "kind": KIND_OPERATING},
    {"key": "airtime_data", "label": "Airtime & data", "kind": KIND_OPERATING},
    {"key": "wages_salaries", "label": "Wages & salaries", "kind": KIND_OPERATING},
    {"key": "repairs_maintenance", "label": "Repairs & maintenance", "kind": KIND_OPERATING},
    {"key": "marketing", "label": "Marketing & advertising", "kind": KIND_OPERATING},
    {"key": "bank_momo_charges", "label": "Bank & MoMo charges", "kind": KIND_OPERATING},
    {"key": "licenses_permits", "label": "Licences & permits", "kind": KIND_OPERATING},
    {"key": "packaging", "label": "Packaging & supplies", "kind": KIND_OPERATING},
    {"key": "security", "label": "Security", "kind": KIND_OPERATING},
    {"key": "professional_fees", "label": "Professional fees", "kind": KIND_OPERATING},
    {"key": "other", "label": "Other expense", "kind": KIND_OPERATING},
    # Excluded from operating expenses — see module docstring.
    {"key": "stock_purchase", "label": "Stock purchase", "kind": KIND_COGS},
    {"key": "owner_drawings", "label": "Owner drawings", "kind": KIND_NON_OPERATING},
    {"key": "loan_repayment", "label": "Loan repayment", "kind": KIND_NON_OPERATING},
]

CATEGORY_BY_KEY: dict[str, dict[str, str]] = {c["key"]: c for c in EXPENSE_CATEGORIES}

CATEGORY_KEYS: set[str] = set(CATEGORY_BY_KEY)

OPERATING_CATEGORY_KEYS: list[str] = [
    c["key"] for c in EXPENSE_CATEGORIES if c["kind"] == KIND_OPERATING
]

PAYMENT_METHODS: set[str] = {"cash", "momo", "bank", "credit", "other"}

# Methods that move cash out of the business today (mirrors how AnalyticsService
# .cash_flow counts inflows from cash and momo sales).
CASH_PAYMENT_METHODS: list[str] = ["cash", "momo"]


def category_label(key: str) -> str:
    """Human label for a category key, falling back to the key itself."""
    entry = CATEGORY_BY_KEY.get(key)
    return entry["label"] if entry else key


def category_kind(key: str) -> str:
    """Accounting kind for a category key. Unknown keys are treated as operating."""
    entry = CATEGORY_BY_KEY.get(key)
    return entry["kind"] if entry else KIND_OPERATING
