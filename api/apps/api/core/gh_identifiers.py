"""Ghana identity document format constants used for Pydantic field validation."""

# Ghana National Identification Authority card: GHA-XXXXXXXXX-D (9 digits, check digit)
GHANA_CARD_PATTERN = r"^GHA-[0-9]{9}-[0-9]$"

# Ghana Revenue Authority Tax Identification Number: either 11 digits or
# legacy/business refs such as C0012345678 used in older records.
TIN_PATTERN = r"^([0-9]{11}|[A-Z][0-9]{10})$"
