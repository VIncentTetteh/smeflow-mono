# Analytics Screen Expansion: Finance + Customers + Export

**Date:** 2026-06-05
**Status:** Approved

## Context

The `stock.tsx` screen (shown as "Analytics" in the app, accessed from the More menu) currently shows only revenue trends derived from `GET /analytics/revenue`. The backend has P&L, cash flow, customer analytics, and CSV/Excel export endpoints that are completely unused. This spec adds three content tabs and an export button to the existing screen.

---

## Navigation

Add a **content tab bar** below the existing period/group-by controls:

```
[ Overview ]  [ Finance ]  [ Customers ]
```

- **Overview**: existing revenue trend + payment mix + top sellers — no change to existing content
- **Finance**: P&L statement + cash flow, both using the selected `period` (7d / 30d / 90d)
- **Customers**: top customers list + customer stats

The period selector (7d / 30d / 90d) and group-by toggle remain at the top and apply to all three tabs.

An **export icon button** (share-outline) is added to the screen header row. On press: triggers async export for the current period, polls for completion, opens download URL.

---

## Finance Tab

### P&L Card

API: `GET /api/v1/analytics/pnl?from_date=&to_date=`

Backend response shape:
```json
{
  "revenue": 4200.00,
  "net_revenue": 4200.00,
  "cogs": 2100.00,
  "gross_profit": 2100.00,
  "gross_margin_pct": 50.0
}
```

Display:
| Row | Value |
|---|---|
| Revenue | GH₵ revenue |
| Cost of goods | GH₵ cogs |
| **Gross profit** | **GH₵ gross_profit** |
| Gross margin | gross_margin_pct % |

Loading and error states. Error: "Could not load P&L data" with retry.

### Cash Flow Card

API: `GET /api/v1/analytics/cash-flow?from_date=&to_date=`

Backend response shape:
```json
{
  "cash_inflow": 2500.00,
  "momo_inflow": 1200.00,
  "total_inflow": 3700.00,
  "outstanding_credit": 500.00,
  "total_sales": 42
}
```

Display:
| Row | Value |
|---|---|
| Cash collected | GH₵ cash_inflow |
| MoMo collected | GH₵ momo_inflow |
| **Total inflow** | **GH₵ total_inflow** |
| Outstanding credit | GH₵ outstanding_credit |

---

## Customers Tab

### Top Customers List

API: `GET /api/v1/analytics/customers/top?from_date=&to_date=&limit=10`

Backend response: array of:
```json
{
  "customer_id": "uuid",
  "name": "Ama Mensah",
  "phone": "+233244000001",
  "purchase_count": 7,
  "total_spent": 840.00,
  "outstanding": 120.00
}
```

Display: ranked list (1, 2, 3…) with name, phone, purchase count, total spend, outstanding credit badge if > 0.

Empty state: "No customer data for this period."

### Customer Stats Row

API: `GET /api/v1/analytics/customers?period=30d&sort=revenue&limit=10`

Compute and show:
- **Total customers**: length of the returned array
- **Avg order value**: sum(total_spent) / sum(purchase_count)
- **Repeat customers**: count(customers with purchase_count > 1) / total customers × 100 (%)

Display as 3 metric chips above the top customers list.

---

## Export

API: `POST /api/v1/analytics/export` with body:
```json
{ "report": "revenue", "format": "xlsx", "group_by": "day", "from_date": "...", "to_date": "..." }
```

Then poll: `GET /api/v1/analytics/export/download?job_id=<job_id>` until `status === "ready"` (max 10 polls, 2s interval). When ready, `download_url` is available → open with `Linking.openURL`.

UI flow:
1. Export icon button in header
2. On press: show a small "Exporting…" toast / spinner next to the icon
3. On success: open URL; hide spinner
4. On error / timeout: `Alert.alert('Export failed', ...)`

Export always uses `format: 'xlsx'` and `report: 'revenue'`.

---

## New Types

Add to `src/types/analytics.ts` (new file):

```typescript
import type { UUID } from './common';

export interface PnLDto {
  revenue: number;
  net_revenue: number;
  cogs: number;
  gross_profit: number;
  gross_margin_pct: number;
}

export interface CashFlowDto {
  from_date: string;
  to_date: string;
  cash_inflow: number;
  momo_inflow: number;
  total_inflow: number;
  outstanding_credit: number;
  total_sales: number;
}

export interface TopCustomerDto {
  customer_id: UUID;
  name: string;
  phone: string | null;
  purchase_count: number;
  total_spent: number;
  outstanding: number;
}

export interface ExportJobDto {
  job_id: string;
  status: string;
  download_url?: string | null;
}
```

---

## New API Functions

Add to `src/api/analytics.api.ts`:

```typescript
export async function getPnL(params: { from_date: string; to_date: string }): Promise<PnLDto>
export async function getCashFlow(params: { from_date: string; to_date: string }): Promise<CashFlowDto>
export async function getTopCustomers(params: { from_date: string; to_date: string; limit?: number }): Promise<TopCustomerDto[]>
export async function getCustomerAnalytics(params: { period: string; limit?: number }): Promise<TopCustomerDto[]>
export async function exportAnalytics(body: { report: string; format: string; group_by: string; from_date: string; to_date: string }): Promise<ExportJobDto>
export async function getExportDownload(params: { job_id: string }): Promise<ExportJobDto>
```

---

## New Hooks

Add to `src/api/hooks/featureHooks.ts`:

```typescript
useAnalyticsPnL(params)        // useQuery, queryKey ['analytics-pnl', params], staleTime 30_000
useAnalyticsCashFlow(params)   // useQuery, queryKey ['analytics-cash-flow', params], staleTime 30_000
useTopCustomers(params)        // useQuery, queryKey ['analytics-top-customers', params], staleTime 30_000
useCustomerAnalytics(params)   // useQuery, queryKey ['analytics-customers', params], staleTime 30_000
useExportAnalytics()           // useMutation, calls exportAnalytics then polls getExportDownload
```

The export mutation handles polling internally: after posting the job, poll `getExportDownload` up to 10 times with 2s delay using `setInterval`/`clearInterval`, then resolve with the download URL or reject on timeout.

---

## Changes to stock.tsx

1. Add `analyticsTab` state: `'overview' | 'finance' | 'customers'`
2. Add 3-tab bar row below the existing period/group-by controls
3. Existing content is the `overview` tab (no structural change — just wrap in `{analyticsTab === 'overview' && ...}`)
4. Add `{analyticsTab === 'finance' && ...}` rendering P&L + cash flow cards
5. Add `{analyticsTab === 'customers' && ...}` rendering stats row + top customers list
6. Add export icon button to the header

---

## Out of Scope

- P&L comparison to previous period (endpoint supports it but adds complexity)
- Customer segmentation / RFM analysis (`/analytics/customers/advanced`)
- Predictive analytics / benchmarking (P4)
- Multiple export formats (always xlsx)

---

## Verification

1. Open Analytics screen (from More menu)
2. Tap "Finance" tab → P&L and cash flow cards load with correct numbers
3. Change period from 30d to 7d → both cards update
4. Tap "Customers" tab → top customer list loads, stats show correctly
5. Tap export icon → "Exporting…" spinner appears → XLSX file opens
6. Network tab: confirm calls to `/analytics/pnl`, `/analytics/cash-flow`, `/analytics/customers/top`, `/analytics/customers`, `/analytics/export`
