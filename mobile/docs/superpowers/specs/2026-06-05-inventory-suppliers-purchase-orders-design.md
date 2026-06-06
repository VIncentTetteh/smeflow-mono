# Inventory: Suppliers & Purchase Orders

**Date:** 2026-06-05
**Status:** Approved

## Context

The backend has a full supplier management and purchase order (PO) API under `/api/v1/inventory/`. The mobile app has no UI for any of this. Merchants cannot track purchases from suppliers, cannot receive stock against POs, and cannot close the procure-to-stock loop in-app. This spec covers adding that UI.

---

## Navigation

Add two new tabs to the existing `app/owner/inventory.tsx` screen:

```
[ Items ] [ Suppliers ] [ Orders ]
```

The current screen has a single "Items" view. This becomes tab 1 of 3. No new top-level routes. Tab bar follows the same pattern as `payroll.tsx` and `tax.tsx`.

---

## Tab 1: Items (existing — no change)

The existing items view remains unchanged.

---

## Tab 2: Suppliers

### Layout

- Scrollable list of suppliers (name, phone/email, address snippet)
- "+" button in the screen header (consistent with other screens) opens the **Add Supplier** modal
- Each row has an edit icon that opens the **Edit Supplier** modal

### Add Supplier modal (bottom-sheet)

Fields:
| Field | Required | Notes |
|---|---|---|
| Name | Yes | Business or contact name |
| Phone | No | Ghana phone |
| Email | No | |
| Address | No | Free text |

On submit: `POST /api/v1/inventory/suppliers` → refresh supplier list.

### Edit Supplier modal

Same form pre-filled. On save: `PATCH /api/v1/inventory/suppliers/{id}`.  
Includes a **Delete** option (red, with Alert confirmation) → `DELETE /api/v1/inventory/suppliers/{id}`.

### Empty state

"No suppliers yet. Tap + to add your first supplier."

---

## Tab 3: Orders (Purchase Orders)

### Layout

- Scrollable list of POs, each row showing: supplier name, expected delivery date, number of line items, status badge
- Status badges: `draft` (grey), `submitted` (blue), `received` (green), `cancelled` (red)
- "Create PO" button in header
- Tap a row → expand inline to show line items and a **Mark Received** button (shown only when status is `draft` or `submitted`)

### Create PO — 3-step bottom-sheet

**Step 1: Supplier**
- Picker/search over the supplier list (fetched via `GET /api/v1/inventory/suppliers`)
- If no suppliers: prompt to add one first (navigate to Suppliers tab)

**Step 2: Line items**
- Search and select existing inventory items (via `GET /api/v1/inventory/items/lookup`)
- For each item: quantity (number input) and cost price (GH₵, pre-filled from item's `cost_price`, editable)
- "Add another item" button
- At least one line item is required

**Step 3: Details**
| Field | Required | Notes |
|---|---|---|
| Expected delivery date | Yes | Date picker |
| Reference number | No | Supplier's PO/invoice ref |
| Payment terms | No | Free text (e.g. "Net 30") |
| Notes | No | Internal notes |

On submit: `POST /api/v1/inventory/purchase-orders` with body:
```json
{
  "supplier_id": "uuid",
  "expected_delivery_date": "2026-06-20",
  "line_items": [{ "item_id": "uuid", "qty": 10, "cost_price": 25.00 }],
  "reference_number": "PO-2026-001",
  "payment_terms": "Net 30",
  "notes": "..."
}
```

### Mark Received flow

When the merchant taps **Mark Received** on a PO:

1. Show a modal with:
   - Informational summary: "Receiving X items from [Supplier]"
   - **Supplier invoice ref** (text input, pre-filled with PO `reference_number` if set)
   - **VAT amount (GH₵)** (pre-filled: sum of `cost_price * qty * 0.15` across all line items, editable)
   - Subtotal (read-only: sum of `cost_price * qty`)

2. On confirm, call in sequence:
   - `POST /api/v1/inventory/purchase-orders/{id}/receive` → updates stock levels
   - `POST /api/v1/tax/input-vat` with `{ supplier_name, invoice_ref, purchase_date: today, subtotal, vat_amount }` → records input VAT

3. On success: show "Stock received and input VAT recorded" toast. Refresh PO list and inventory items.

4. On failure of either call: show specific error. If PO receive succeeds but input VAT fails, show partial-success warning: "Stock updated, but VAT recording failed — add it manually on the Tax screen."

---

## API Layer

### New functions in `src/api/inventory.api.ts`

```ts
listSuppliers(): Promise<SupplierDto[]>            // GET /inventory/suppliers
createSupplier(body: CreateSupplierDto): Promise<SupplierDto>   // POST /inventory/suppliers
updateSupplier(id, body: Partial<CreateSupplierDto>): Promise<SupplierDto>  // PATCH /inventory/suppliers/{id}
deleteSupplier(id: string): Promise<void>          // DELETE /inventory/suppliers/{id}
listPurchaseOrders(): Promise<PurchaseOrderDto[]>  // GET /inventory/purchase-orders
createPurchaseOrder(body: CreatePurchaseOrderDto): Promise<PurchaseOrderDto>  // POST /inventory/purchase-orders
receivePurchaseOrder(id: string): Promise<PurchaseOrderDto>  // POST /inventory/purchase-orders/{id}/receive
```

`recordInputVAT` already exists in `src/api/tax.api.ts` — reuse it.

### New hooks in `src/api/hooks/featureHooks.ts`

```ts
useSuppliers()              // useQuery ['suppliers']
useCreateSupplier()         // useMutation, invalidates ['suppliers']
useUpdateSupplier()         // useMutation, invalidates ['suppliers']
useDeleteSupplier()         // useMutation, invalidates ['suppliers']
usePurchaseOrders()         // useQuery ['purchase-orders']
useCreatePurchaseOrder()    // useMutation, invalidates ['purchase-orders']
useReceivePurchaseOrder()   // useMutation, invalidates ['purchase-orders'] AND ['inventory-items']
```

All `useQuery` hooks: `staleTime: 30_000`, `retry: 1`.

---

## Types — additions to `src/types/inventory.ts`

```ts
export interface SupplierDto {
  id: UUID;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  created_at?: ISODateTime;
}

export interface CreateSupplierDto {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface POLineItemDto {
  item_id: UUID;
  name?: string;
  qty: number;
  cost_price: number;
}

export interface PurchaseOrderDto {
  id: UUID;
  supplier_id: UUID;
  supplier_name?: string;
  status: 'draft' | 'submitted' | 'received' | 'cancelled';
  expected_delivery_date?: string;
  reference_number?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  line_items?: POLineItemDto[];
  created_at?: ISODateTime;
  received_at?: ISODateTime | null;
}

export interface CreatePurchaseOrderDto {
  supplier_id: string;
  expected_delivery_date: string;
  line_items: Array<{ item_id: string; qty: number; cost_price: number }>;
  reference_number?: string;
  payment_terms?: string;
  notes?: string;
}
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No suppliers when creating PO | Disable "Create PO" button; show inline "Add a supplier first" prompt |
| PO receive succeeds, input VAT fails | Show partial-success warning with link to Tax screen |
| Delete supplier that has POs | Backend returns 409; show "Cannot delete — supplier has purchase orders" |
| Item lookup fails during PO creation | Show retry button inside line-items step |

---

## Out of Scope

- Offline-first / WatermelonDB sync for suppliers or POs (online-only, matches payroll/credit/tax pattern)
- Barcode on supplier items
- PO PDF generation
- Multi-currency POs

---

## Verification

1. Navigate to Inventory → Suppliers tab: add a supplier, edit it, delete it
2. Navigate to Orders tab: create a PO (all 3 steps), verify it appears in list with correct status
3. Tap "Mark received" on a PO: confirm stock levels increase on the Items tab, confirm a new input VAT entry appears on the Tax screen
4. Attempt to delete a supplier with existing POs: confirm the error message appears
5. Create a PO with no suppliers present: confirm the "add a supplier first" prompt appears
