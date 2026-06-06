"""
GhIPSS GhQR payload generator (EMV QR Code Specification).
Supports both static (no amount) and dynamic (amount-specified) QR codes.
"""

from decimal import Decimal


def _tlv(tag: str, value: str) -> str:
    """Encode a TLV field: tag (2 chars) + length (2 chars) + value."""
    length = f"{len(value):02d}"
    return f"{tag}{length}{value}"


def _crc16(data: str) -> str:
    """CRC16-CCITT checksum as 4-char uppercase hex."""
    crc = 0xFFFF
    for char in data.encode("utf-8"):
        crc ^= char << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc <<= 1
            crc &= 0xFFFF
    return f"{crc:04X}"


def generate_ghqr_payload(business: object, amount: Decimal | None = None) -> str:
    """
    Generate a GhIPSS GhQR EMV-compliant QR payload.

    Args:
        business: Business ORM object with .name, .ghqr_merchant_id attributes.
        amount: If provided, generates a dynamic QR. If None, static QR (no amount).

    Returns:
        QR payload string to be encoded into a QR image.
    """
    is_dynamic = amount is not None

    parts = []
    parts.append(_tlv("00", "01"))  # Payload Format Indicator
    parts.append(_tlv("01", "12" if is_dynamic else "11"))  # Point of Initiation

    # Merchant Account Information (GH.GHIPSS.GHQR)
    merchant_id = getattr(business, "ghqr_merchant_id", "") or "SMEFLOW000001"
    merchant_info = _tlv("00", "GH.GHIPSS.GHQR") + _tlv("01", merchant_id)
    parts.append(_tlv("26", merchant_info))

    parts.append(_tlv("52", "5999"))  # Merchant Category Code (general retail)
    parts.append(_tlv("53", "936"))  # Transaction Currency (GHS = 936 ISO 4217)

    if is_dynamic and amount:
        parts.append(_tlv("54", f"{amount:.2f}"))  # Transaction Amount

    parts.append(_tlv("58", "GH"))  # Country Code
    parts.append(_tlv("59", getattr(business, "name", "SME Business")[:25]))  # Merchant Name
    parts.append(_tlv("60", "ACCRA"))  # Merchant City

    # CRC placeholder — always last
    raw = "".join(parts) + "6304"
    crc = _crc16(raw)
    parts.append(_tlv("63", crc))

    return "".join(parts)


def generate_qr_image_bytes(payload: str) -> bytes:
    """Generate a QR code PNG from payload string. Returns raw PNG bytes."""
    import io

    import qrcode  # type: ignore[import-untyped]

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
