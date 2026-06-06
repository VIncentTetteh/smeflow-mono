# Barcode & QR Scanning — API Contract

**Version:** 1.0
**Base URL:** `https://api.smeflow.app/api/v1`
**Auth:** Bearer JWT (obtained from `POST /auth/token`)

---

## Overview

SMEFlow provides two inventory lookup modes for point-of-sale and stock-taking apps:

| Mode | Endpoint | Use case |
|------|----------|----------|
| Single lookup | `GET /inventory/items/lookup` | Scan one item, instant response |
| Batch lookup | `POST /inventory/items/lookup/batch` | Scan multiple items, single round-trip |

Both endpoints are scoped to the authenticated user's active business. Items from other businesses are never returned.

---

## 1. Single Item Lookup

### `GET /inventory/items/lookup`

Look up a single item by its barcode **or** SKU.

**Query Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `barcode` | string | One of | Exact barcode value (EAN-13, EAN-8, GhQR, etc.) |
| `sku` | string | One of | Exact stock-keeping unit code |

**Response — 200 OK**

```json
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "Gino Tomato Paste 400g",
  "sku": "GINO-400G",
  "barcode": "6001234567890",
  "unit": "tin",
  "current_stock": 48,
  "low_stock_threshold": 10,
  "sell_price": "5.50",
  "category_id": null,
  "is_low_stock": false,
  "created_at": "2025-01-15T08:00:00Z"
}
```

**Error Responses**

| Code | Condition |
|------|-----------|
| 404 | No item matches the barcode or SKU |
| 422 | Neither `barcode` nor `sku` provided |

---

## 2. Batch Lookup

### `POST /inventory/items/lookup/batch`

Look up **up to 50 barcodes and 50 SKUs** in a single HTTP request. Designed for POS scanners that queue scans before flushing them to the server.

**Request Body**

```json
{
  "barcodes": ["6001234567890", "6009876543210", "5000112637922"],
  "skus": ["RICE-50KG", "OIL-5L"]
}
```

| Field | Type | Constraints |
|-------|------|-------------|
| `barcodes` | `string[]` | Max 50 items, each max 100 chars |
| `skus` | `string[]` | Max 50 items, each max 100 chars |

At least one of `barcodes` or `skus` must be non-empty.

**Response — 200 OK**

```json
{
  "total_queried": 5,
  "found": 4,
  "not_found": 1,
  "results": [
    {
      "query": "6001234567890",
      "query_type": "barcode",
      "found": true,
      "item": {
        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "name": "Gino Tomato Paste 400g",
        "sku": "GINO-400G",
        "barcode": "6001234567890",
        "unit": "tin",
        "current_stock": 48,
        "low_stock_threshold": 10,
        "sell_price": "5.50",
        "is_low_stock": false,
        "created_at": "2025-01-15T08:00:00Z"
      },
      "error": null
    },
    {
      "query": "9999999999999",
      "query_type": "barcode",
      "found": false,
      "item": null,
      "error": "not_found"
    },
    {
      "query": "RICE-50KG",
      "query_type": "sku",
      "found": true,
      "item": {
        "id": "c2d4e9f0-1234-5678-abcd-ef0123456789",
        "name": "Imported Rice 50kg",
        "sku": "RICE-50KG",
        "barcode": null,
        "unit": "bag",
        "current_stock": 12,
        "low_stock_threshold": 5,
        "sell_price": "280.00",
        "is_low_stock": false,
        "created_at": "2025-02-01T09:30:00Z"
      },
      "error": null
    }
  ]
}
```

**ItemLookupResult schema**

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | The barcode or SKU value sent by the client |
| `query_type` | `"barcode" \| "sku"` | Which field was matched |
| `found` | boolean | `true` if an item was located |
| `item` | ItemResponse \| null | Full item object, or `null` if not found |
| `error` | string \| null | `"not_found"` when item is missing, else `null` |

**Error Responses**

| Code | Condition |
|------|-----------|
| 422 | Both `barcodes` and `skus` are empty lists |
| 422 | Either list exceeds 50 items |

---

## 3. QR Code Format (GhQR)

SMEFlow supports GhQR-encoded items in addition to EAN barcodes.

GhQR payload (scanned from a product QR label) is a URL-encoded string:

```
smeflow://item?bc=6001234567890&biz=3fa85f64-5717-4562-b3fc-2c963f66afa6
```

| Parameter | Description |
|-----------|-------------|
| `bc` | Barcode value — pass directly as `barcodes[n]` |
| `biz` | Business UUID — for cross-business validation (optional) |

The mobile client should strip the `smeflow://item?bc=` prefix and use the raw barcode value in the API call.

---

## 4. Performance Characteristics

| Metric | Value |
|--------|-------|
| Typical latency (single) | < 20 ms |
| Typical latency (batch 50) | < 40 ms |
| Max batch size | 50 barcodes + 50 SKUs |
| DB queries per batch call | ≤ 2 (one IN query per type) |
| Rate limit | 120 req/min per business |

---

## 5. Integration Example (Python)

```python
import httpx

async def scan_batch(token: str, barcodes: list[str]) -> dict:
    async with httpx.AsyncClient(base_url="https://api.smeflow.app/api/v1") as client:
        resp = await client.post(
            "/inventory/items/lookup/batch",
            json={"barcodes": barcodes, "skus": []},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json()

# Usage
result = await scan_batch(token, ["6001234567890", "6009876543210"])
for item_result in result["results"]:
    if item_result["found"]:
        print(f"{item_result['item']['name']}: GH₵{item_result['item']['sell_price']}")
    else:
        print(f"Unknown barcode: {item_result['query']}")
```

---

## 6. Changelog

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-05-04 | Initial contract — single + batch lookup, GhQR notes |
